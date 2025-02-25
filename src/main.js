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
        const response = await axios.post(url, data);
        // console.log('消息已發送到 Telegram:', response.data);
        console.log('消息已發送到 Telegram');
    } catch (error) {
        // if (error.response) {
        //     console.error('發送 Telegram 消息時出錯:', error.response.status, error.response.data);
        // } else if (error.request) {
        //     console.error('發送 Telegram 消息時出錯:', error.request);
        // } else {
        //     console.error('發送 Telegram 消息時出錯:', error.message);
        // }
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

        // 显示浏览器窗口&使用自定义窗口大小
        const browser = await puppeteer.launch({ 
            headless: false, 
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
        // await page.setViewport({ width: 1366, height: 768 });
        // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36');
        // await page.evaluateOnNewDocument(() => {
        //     delete Object.getPrototypeOf(navigator).webdriver;
        // });

        let url = `https://${panel}/login/?next=/`;

        try {
            await page.goto(url);

            const usernameInput = await page.$('#id_username');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('#id_username', username);
            await page.type('#id_password', password);

            const loginButton = await page.$('#submit');
            if (loginButton) {
                await loginButton.click();
            } else {
                throw new Error('無法找到登錄按鈕');
            }

            await page.waitForNavigation();

            const isLoggedIn = await page.evaluate(() => {
                const logoutButton = document.querySelector('a[href="/logout/"]');
                return logoutButton !== null;
            });

            if (isLoggedIn) {
                const nowUtc = formatToISO(new Date());
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000)); // 臺灣時間
                console.log(`帳號 ${username} 於臺灣時間 ${nowBeijing}（UTC時間 ${nowUtc}）登錄成功！`);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 於臺灣時間 ${nowBeijing}（UTC時間 ${nowUtc}）登錄成功！`);
                }
            } else {
                console.error(`帳號 ${username} 登錄失敗，請檢查帳號和密碼是否正確。`);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄失敗，請檢查帳號和密碼是否正確。`);
                }
            }
        } catch (error) {
            console.error(`帳號 ${username} 登錄時出現錯誤: ${error}`);
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `帳號 ${username} 登錄時出現錯誤: ${error.message}`);
            }
        } finally {
            // 模拟人类行为
            // await page.waitForTimeout(1000 + Math.floor(Math.random() * 2000)); 
            // await page.type('#id_username', 'testuser', { delay: 100 + Math.floor(Math.random() * 100) });
            // await page.click('#submit');
            // await page.waitForNavigation();
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000; // 随机延时1秒到5秒之间
            await delayTime(delay);
        }
    }
    console.log('所有帳號登錄完成！');
})();
