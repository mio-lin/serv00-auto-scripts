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
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let url = `https://${panel}/login/?next=/`;

        try {
            console.log(`[${username}] 正在連線至 ${url}...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });

            // 1. 等待輸入框出現
            await page.waitForSelector('#id_username', { visible: true, timeout: 60000 });

            await page.type('#id_username', username, { delay: 100 });
            await page.type('#id_password', password, { delay: 100 });

            const btnSelector = 'button.button--primary, button[type="submit"]';
            await page.waitForSelector(btnSelector, { timeout: 30000 });

            // 2. 執行暴力點擊與表單提交
            console.log(`[${username}] 正在送出登入表單...`);
            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) {
                    btn.click();
                    if (btn.form) btn.form.submit();
                }
            }, btnSelector);
            
            // 3. 等待跳轉完成
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log("等待跳轉超時，嘗試直接判斷結果..."));

            // 4. 改進的判斷邏輯：
            // 只要頁面 URL 不再包含 "/login/"，或是出現了登出關鍵字，就視為成功。
            const currentUrl = page.url();
            const pageContent = await page.content();
            
            const isLoggedIn = await page.evaluate(() => {
                const logoutKeywords = ['Logout', 'Wyloguj', 'Zamknij', 'Sign out'];
                const hasLogoutBtn = document.querySelector('a[href="/logout/"]') !== null;
                const hasKeyword = logoutKeywords.some(kw => document.body.innerText.includes(kw));
                return hasLogoutBtn || hasKeyword;
            });

            if (isLoggedIn || !currentUrl.includes('/login/')) {
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                const msg = `✅ [${username}] 台灣時間 ${nowBeijing} 登錄成功！`;
                console.log(msg);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, msg);
                }
            } else {
                // 如果還在登入頁，提取錯誤訊息
                const errorMsg = await page.evaluate(() => {
                    const alert = document.querySelector('.alert-error, .errorlist');
                    return alert ? alert.innerText.trim() : '未知原因（可能密碼錯誤）';
                });
                throw new Error(`登錄失敗: ${errorMsg}`);
            }

        } catch (error) {
            console.error(`[${username}] 錯誤: ${error.message}`);
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, `❌ [${username}] 登錄失敗: ${error.message}`);
            }
        } finally {
            await page.close();
            await browser.close();
            await delayTime(3000);
        }
    }
})();
