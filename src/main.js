import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    if (!token || !chatId) return;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        await axios.post(url, { chat_id: chatId, text: message });
        console.log('消息已發送到 Telegram');
    } catch (error) {
        console.error('Telegram 消息發送失敗');
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accountsPath = path.join(__dirname, '../accounts.json');
    
    if (!fs.existsSync(accountsPath)) {
        console.error('找不到 accounts.json 檔案');
        process.exit(1);
    }

    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    for (const account of accounts) {
        const { username, password, panel } = account;

        // GitHub Actions 必須使用的啟動參數
        const browser = await puppeteer.launch({ 
            headless: "new", 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: { width: 1920, height: 1080 }
        });
        
        const page = await browser.newPage();
        
        // 關鍵：偽裝瀏覽器特徵，避免被 Cloudflare 阻擋
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

        try {
            console.log(`正在嘗試登入帳號: ${username} (${panel})...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

            // 1. 等待輸入框出現（這能同時處理頁面載入與 Cloudflare 轉圈）
            await page.waitForSelector('#id_username', { visible: true, timeout: 60000 });

            const usernameInput = await page.$('#id_username');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('#id_username', username, { delay: 50 });
            await page.type('#id_password', password, { delay: 50 });

            // 2. 修正後的按鈕選擇器
            const loginButtonSelector = 'button.button--primary[type="submit"]';
            await page.waitForSelector(loginButtonSelector, { visible: true, timeout: 30000 });
            
            const loginButton = await page.$(loginButtonSelector);
            if (loginButton) {
                await loginButton.click();
                console.log('已點擊登入按鈕');
            } else {
                throw new Error('無法找到登錄按鈕');
            }

            // 3. 等待登入成功後的跳轉
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            const isLoggedIn = await page.evaluate(() => {
                return document.querySelector('a[href="/logout/"]') !== null;
            });

            if (isLoggedIn) {
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                const successMsg = `帳號 ${username} 於臺灣時間 ${nowBeijing} 登錄成功！`;
                console.log(successMsg);
                await sendTelegramMessage(telegramToken, telegramChatId, successMsg);
            } else {
                throw new Error('登錄成功後未偵測到登出按鈕，可能登錄失敗');
            }

        } catch (error) {
            console.error(`帳號 ${username} 登錄失敗: ${error.message}`);
            // 在 GitHub Actions 中如果失敗，截圖可以幫助檢查原因（可選）
            // await page.screenshot({ path: `error-${username}.png` });
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄錯誤: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            // 隨機延遲避免被伺服器偵測
            await delayTime(Math.floor(Math.random() * 5000) + 2000);
        }
    }
    console.log('所有任務執行完畢');
})();
