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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

        try {
            console.log(`[${username}] 正在連線至 ${url}...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

            await page.waitForSelector('#id_username', { visible: true, timeout: 60000 });
            await page.type('#id_username', username, { delay: 50 });
            await page.type('#id_password', password, { delay: 50 });

            // 執行表單提交
            await page.evaluate(() => {
                const form = document.querySelector('form[action="/login/"]');
                if (form) form.submit();
                else document.querySelector('button[type="submit"]').click();
            });

            // 關鍵修正：等待你截圖中的 DevilWEB 標誌或登出連結出現
            console.log(`[${username}] 等待後台介面載入...`);
            await Promise.race([
                page.waitForSelector('a.navbar-brand.brand', { timeout: 30000 }),
                page.waitForSelector('a[href="/logout/"]', { timeout: 30000 })
            ]).catch(() => console.log("等待 UI 元素超時，進行最後檢查..."));

            // 最終判定邏輯 (根據截圖特徵)
            const result = await page.evaluate(() => {
                const brand = document.querySelector('a.navbar-brand.brand');
                const logout = document.querySelector('a[href="/logout/"]');
                // 檢查是否包含 DevilWEB 或 登出字樣
                const hasBrand = brand && brand.innerText.includes('DevilWEB');
                const hasLogout = logout !== null;
                return { success: hasBrand || hasLogout, url: window.location.href };
            });

            if (result.success || !page.url().includes('/login/')) {
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                const msg = `✅ [${username}] 台灣時間 ${nowBeijing} 登錄成功！`;
                console.log(msg);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, msg);
                }
            } else {
                throw new Error("未能進入後台主頁，請確認帳密是否正確。");
            }

        } catch (error) {
            console.error(`[${username}] 錯誤: ${error.message}`);
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `❌ [${username}] ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            await delayTime(2000);
        }
    }
})();
