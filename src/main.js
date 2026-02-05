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
            headless: "new", 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled' // 隱藏自動化特徵
            ]
        });
        
        const page = await browser.newPage();
        // 模擬真實瀏覽器，避免被 Cloudflare 直接拒絕
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

        try {
            console.log(`[${username}] 正在連線至 ${url}...`);
            
            // 1. 增加等待時間到 90 秒，並使用 networkidle2
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

            // 2. 輸出頁面標題，幫助除錯
            const title = await page.title();
            console.log(`[${username}] 目前頁面標題: ${title}`);

            // 3. 檢查是否卡在 Cloudflare，如果是就多等 10 秒
            if (title.includes('Just a moment')) {
                console.log('偵測到 Cloudflare 驗證，等待中...');
                await delayTime(10000);
            }

            // 4. 改用更寬鬆的 waitForSelector，先確定輸入框出現
            await page.waitForSelector('#id_username', { visible: true, timeout: 60000 });

            await page.type('#id_username', username, { delay: 50 });
            await page.type('#id_password', password, { delay: 50 });

            // 5. 按鈕選擇器：使用多重匹配，增加成功率
            const btnSelector = 'button[type="submit"]';
            await page.waitForSelector(btnSelector, { visible: true, timeout: 30000 });

            // 6. 使用 page.evaluate 點擊（比 page.click 更暴力、更有效）
            await page.evaluate((sel) => {
                document.querySelector(sel).click();
            }, btnSelector);
            
            console.log('已發送點擊指令');

            // 7. 等待跳轉
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

            const isLoggedIn = await page.evaluate(() => {
                return document.querySelector('a[href="/logout/"]') !== null;
            });

            if (isLoggedIn) {
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                console.log(`[${username}] 台灣時間 ${nowBeijing} 登錄成功！`);
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄成功！`);
            } else {
                throw new Error('未偵測到登出按鈕，可能密碼錯誤或登錄失敗');
            }

        } catch (error) {
            console.error(`[${username}] 錯誤: ${error.message}`);
            // 如果失敗，可以考慮在這裡加上 page.screenshot 以便在 Actions 產物中查看
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄失敗: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            await delayTime(2000);
        }
    }
})();
