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
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = {
        chat_id: chatId,
        text: message
    };
    try {
        await axios.post(url, data);
        console.log('消息已發送到 Telegram');
    } catch (error) {
        console.error('Telegram 消息發送失敗');
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    for (const account of accounts) {
        const { username, password, panel } = account;

        const browser = await puppeteer.launch({ 
            headless: "new", // 建議在伺服器使用 "new" 模式
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-infobars',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: null,
            ignoreHTTPSErrors: true
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // 1. 等待帳號輸入框出現 (確保 Cloudflare 轉完圈)
            await page.waitForSelector('#id_username', { timeout: 30000 });

            const usernameInput = await page.$('#id_username');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('#id_username', username);
            await page.type('#id_password', password);

            // 2. 修正：使用屬性選擇器尋找登入按鈕
            const loginButtonSelector = 'button[type="submit"]';
            await page.waitForSelector(loginButtonSelector, { visible: true });
            const loginButton = await page.$(loginButtonSelector);

            if (loginButton) {
                await loginButton.click();
            } else {
                throw new Error('無法找到登錄按鈕');
            }

            // 3. 等待登入後的頁面跳轉
            await page.waitForNavigation({ waitUntil: 'networkidle2' });

            const isLoggedIn = await page.evaluate(() => {
                const logoutButton = document.querySelector('a[href="/logout/"]');
                return logoutButton !== null;
            });

            if (isLoggedIn) {
                const nowUtc = formatToISO(new Date());
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                console.log(`帳號 ${username} 於臺灣時間 ${nowBeijing}（UTC時間 ${nowUtc}）登錄成功！`);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 於臺灣時間 ${nowBeijing} 登錄成功！`);
                }
            } else {
                console.error(`帳號 ${username} 登錄失敗，請檢查帳號和密碼。`);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄失敗，請檢查帳號和密碼。`);
                }
            }
        } catch (error) {
            console.error(`帳號 ${username} 登錄時出現錯誤: ${error.message}`);
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄錯誤: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000;
            await delayTime(delay);
        }
    }
    console.log('所有帳號登錄完成！');
})();
