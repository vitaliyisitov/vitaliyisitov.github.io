/**
 * Cloudflare Worker — прокси для Яндекс Диск API.
 *
 * ДЕПЛОЙ (один раз, бесплатно):
 * 1. Зайди на https://workers.cloudflare.com и создай аккаунт
 * 2. Create Worker → вставь этот код → Save and Deploy
 * 3. Settings → Variables → добавь переменную среды:
 *      YADISK_TOKEN  =  твой OAuth-токен Яндекс Диска
 *      ALLOWED_ORIGIN = https://твой-логин.github.io  (или * для любого)
 * 4. Скопируй URL воркера (вида https://yadisk-proxy.ТЕБЯ.workers.dev)
 * 5. Вставь его в firebase.config.js → yadiskWorkerUrl: "https://..."
 *
 * ПОЛУЧИТЬ ТОКЕН ЯНДЕКС ДИСКА (проще всего):
 * 1. Зайди на https://oauth.yandex.ru
 * 2. Создай приложение → права: cloud_api:disk.read + cloud_api:disk.write
 * 3. В поле "Redirect URI" укажи: https://oauth.yandex.ru/verification_code
 * 4. Открой в браузере:
 *    https://oauth.yandex.ru/authorize?response_type=token&client_id=ВАШ_CLIENT_ID
 * 5. После авторизации токен появится в URL после access_token=
 *
 * СТРУКТУРА ПАПОК НА ЯНДЕКС ДИСКЕ:
 * /Ученики/
 *   Иван/
 *     ОГЭ Математика/
 *       Задание 1.pdf
 *       Задание 2.mp4
 *     ОГЭ Информатика/
 *       Задание 5.pdf
 *   Мария/
 *     ЕГЭ Математика/
 *       Задание 3.pdf
 *
 * Кнопка «Синхронизировать» в admin.html сама обойдёт папки,
 * сделает файлы публичными и прикрепит ссылки к заданиям.
 */

const YANDEX_API = "https://cloud-api.yandex.net";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const targetPath = url.pathname + url.search;
    const targetUrl = YANDEX_API + targetPath;

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `OAuth ${env.YADISK_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") || "application/json",
        ...corsHeaders(env),
      },
    });
  },
};

function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
