'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { Redis } = require('@upstash/redis');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.Client(lineConfig);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const SESSION_TTL_SEC = 60 * 60 * 24;

// ══════════════════════════════════════════════════════════════
//  営業時間チェック
// ══════════════════════════════════════════════════════════════
function getBusinessStatus() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const day = now.getDay();
  const hour = now.getHours();
  const min = now.getMinutes();
  const time = hour * 60 + min;

  const AM_START = 9 * 60 + 30;
  const AM_END   = 13 * 60;
  const PM_START = 15 * 60;
  const PM_END_WEEKDAY = 19 * 60;
  const PM_END_SAT     = 18 * 60;

  if (day === 0 || day === 1) {
    return { open: false, message: '本日は定休日（日・月曜日）のため、お電話対応ができません。\nお問い合わせは火曜日以降にお願いいたします。' };
  }

  if (day === 6) {
    if ((time >= AM_START && time < AM_END) || (time >= PM_START && time < PM_END_SAT)) {
      return { open: true };
    }
    return { open: false, message: '現在は営業時間外です。\n\n🕐 土曜の営業時間\n午前 9:30〜13:00\n午後 15:00〜18:00\n\nお時間内に改めてご連絡ください。' };
  }

  if ((time >= AM_START && time < AM_END) || (time >= PM_START && time < PM_END_WEEKDAY)) {
    return { open: true };
  }
  return { open: false, message: '現在は営業時間外です。\n\n🕐 平日の営業時間\n午前 9:30〜13:00\n午後 15:00〜19:00\n\nお時間内に改めてご連絡ください。' };
}

// ══════════════════════════════════════════════════════════════
//  候補日生成（今日から7日分・定休日除く）
// ══════════════════════════════════════════════════════════════
function getCandidateDates() {
  const dates = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  for (let i = 1; dates.length < 6; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const day = d.getDay();
    if (day === 0 || day === 1) continue;
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    dates.push({ label: `${m}/${dd}（${dayNames[day]}）`, day });
  }
  return dates;
}

// ══════════════════════════════════════════════════════════════
//  曜日ごとの予約時間スロット
// ══════════════════════════════════════════════════════════════
function getTimeSlots(day) {
  // 火〜金（2〜5）
  if (day >= 2 && day <= 5) {
    return [
      ['9:30', '10:10', '10:50'],
      ['11:30', '12:10', ''],
      ['15:00', '15:40', '16:20'],
      ['17:00', '17:40', '18:20'],
    ];
  }
  // 土（6）
  if (day === 6) {
    return [
      ['9:30', '10:10', '10:50'],
      ['11:30', '12:10', ''],
      ['15:00', '15:40', '16:20'],
      ['17:00', '17:40', ''],
    ];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
//  Redis セッションヘルパー
// ══════════════════════════════════════════════════════════════
async function getSession(userId) {
  try {
    const data = await redis.get(`session:${userId}`);
    if (!data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
    console.error('[Redis] getSession エラー:', err);
    return null;
  }
}

async function setSession(userId, session) {
  try {
    await redis.set(`session:${userId}`, JSON.stringify(session), {
      ex: SESSION_TTL_SEC,
    });
  } catch (err) {
    console.error('[Redis] setSession エラー:', err);
  }
}

async function deleteSession(userId) {
  try {
    await redis.del(`session:${userId}`);
  } catch (err) {
    console.error('[Redis] deleteSession エラー:', err);
  }
}

// ══════════════════════════════════════════════════════════════
//  Express
// ══════════════════════════════════════════════════════════════
const app = express();

app.get('/health', async (_req, res) => {
  try {
    await redis.set('__health__', Date.now(), { ex: 60 });
    res.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Health] Redis エラー:', err);
    res.status(500).json({ status: 'redis_error' });
  }
});

app.get('/ping',  (_req, res) => res.send('pong'));
app.get('/ping2', (_req, res) => res.send('pong'));

app.post(
  '/webhook',
  line.middleware(lineConfig),
  (req, res) => {
    res.sendStatus(200);
    req.body.events.forEach((event) => {
      handleEvent(event).catch((err) =>
        console.error('[Webhook] handleEvent エラー:', err)
      );
    });
  }
);

// ══════════════════════════════════════════════════════════════
//  イベントハンドラ
// ══════════════════════════════════════════════════════════════
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  try {
    if (['やめる', 'やめます', '最初に戻る', 'メニュー', 'menu', 'Menu'].includes(text)) {
      await deleteSession(userId);
      return sendMenu(event.replyToken);
    }

    const session = await getSession(userId);

    if (!session) {
      return await routeMenuSelection(userId, text, event.replyToken);
    }

    return await continueFlow(userId, text, session, event.replyToken);

  } catch (err) {
    console.error('[handleEvent] エラー:', err);
    await deleteSession(userId);
    await safeReply(event.replyToken,
      '⚠️ エラーが発生しました。お手数ですが、もう一度最初からお試しください。'
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  メニュー選択ルーティング
// ══════════════════════════════════════════════════════════════
async function routeMenuSelection(userId, text, replyToken) {
  if (text.includes('新規予約')) {
    const status = getBusinessStatus();
    if (!status.open) {
      return lineClient.replyMessage(replyToken, msg(status.message));
    }
    await setSession(userId, { type: 'new', step: 'await_date' });
    return sendDatePicker(replyToken);
  }

  if (text.includes('予約（来院中の方）')) {
    const status = getBusinessStatus();
    if (!status.open) {
      return lineClient.replyMessage(replyToken, msg(status.message));
    }
    await setSession(userId, { type: 'revisit', step: 'await_date' });
    return sendDatePicker(replyToken);
  }

  if (text.includes('予約変更') || text.includes('キャンセル')) {
    await setSession(userId, { type: 'change', step: 'await_change_content' });
    return lineClient.replyMessage(replyToken, msg(
      '以下のテンプレートをコピーして内容を記入し、送信してください。\n\n' +
      '──────────────\n' +
      '【予約変更・キャンセル】\n' +
      '・お名前：\n' +
      '・ご予約日時：\n' +
      '・変更後の希望日時（変更の場合）：\n' +
      '・キャンセルの場合は「キャンセル」と記入\n' +
      '──────────────'
    ));
  }

  return sendMenu(replyToken);
}

// ══════════════════════════════════════════════════════════════
//  フロー継続
// ══════════════════════════════════════════════════════════════
async function continueFlow(userId, text, session, replyToken) {
  switch (session.step) {

    case 'await_date': {
      const dates = getCandidateDates();
      const found = dates.find((d) => d.label === text);
      if (!found) {
        return sendDatePicker(replyToken);
      }
      session.date = found.label;
      session.day = found.day;
      session.step = 'await_time';
      await setSession(userId, session);
      return sendTimePicker(replyToken, found.label, found.day);
    }

    case 'await_time': {
      const slots = getTimeSlots(session.day).flat().filter(Boolean);
      if (!slots.includes(text)) {
        return sendTimePicker(replyToken, session.date, session.day);
      }
      session.datetime = `${session.date} ${text}`;
      session.step = 'await_phone';
      await setSession(userId, session);
      return lineClient.replyMessage(replyToken, msg(
        '📱 電話番号を入力してください。\n例）090-1234-5678'
      ));
    }

    case 'await_phone':
      session.phone = text;
      session.step = 'await_symptoms';
      await setSession(userId, session);
      return lineClient.replyMessage(replyToken, msg(
        '🩺 気になる症状の番号を送ってください（複数可）。\n\n' +
        '1.首痛　　2.肩こり　　3.肩の痛み\n' +
        '4.腰痛　　5.膝痛　　6.股関節痛\n' +
        '7.足首痛　8.産後の骨盤矯正\n' +
        '9.交通事故の治療　10.トレーニング\n' +
        '11.リハビリ\n\n' +
        '例）1 4 7'
      ));

    case 'await_symptoms': {
      session.symptoms = text;
      await deleteSession(userId);
      return lineClient.replyMessage(replyToken, msg(
        '✅ 仮予約を受け付けました。\n※予約はまだ確定していません。\n\n' +
        `📅 希望日時：${session.datetime}\n` +
        `📱 電話番号：${session.phone}\n` +
        `🩺 症状：${session.symptoms}\n\n` +
        '院より当日〜翌日中にお電話でご確認いたします。\n' +
        '連絡が取れ次第予約確定になります。\nご了承ください。\n' +
        '※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。\n\n' +
        '健やか整骨院 豊玉院\n📞 03-5946-9959'
      ));
    }

    case 'await_change_content':
      await deleteSession(userId);
      return lineClient.replyMessage(replyToken, msg(
        '✅ 変更・キャンセルのご連絡を受け付けました。\n\n' +
        '院より確認のご連絡をいたします。\n' +
        '※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。\n\n' +
        '健やか整骨院 豊玉院\n📞 03-5946-9959'
      ));

    default:
      await deleteSession(userId);
      return sendMenu(replyToken);
  }
}

// ══════════════════════════════════════════════════════════════
//  日付選択ボタン
// ══════════════════════════════════════════════════════════════
async function sendDatePicker(replyToken) {
  const dates = getCandidateDates();
  return lineClient.replyMessage(replyToken, {
    type: 'flex',
    altText: '希望日を選んでください',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2E7D6E',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: '📅 希望日を選んでください', weight: 'bold', color: '#ffffff', size: 'md' },
          { type: 'text', text: '「やめる」で最初に戻ります', color: '#ffffffaa', size: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: dates.map((d) => flexButton(d.label, d.label)),
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  時間帯選択ボタン
// ══════════════════════════════════════════════════════════════
async function sendTimePicker(replyToken, date, day) {
  const rows = getTimeSlots(day);
  return lineClient.replyMessage(replyToken, {
    type: 'flex',
    altText: '希望時間を選んでください',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2E7D6E',
        paddingAll: '12px',
        contents: [
          { type: 'text', text: `⏰ ${date}の希望時間`, weight: 'bold', color: '#ffffff', size: 'md' },
          { type: 'text', text: '「やめる」で最初に戻ります', color: '#ffffffaa', size: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: rows.map((row) => ({
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: row.map((t) =>
            t ? {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              flex: 1,
              action: { type: 'message', label: t, text: t },
            } : { type: 'filler' }
          ),
        })),
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  メインメニュー
// ══════════════════════════════════════════════════════════════
async function sendMenu(replyToken) {
  return lineClient.replyMessage(replyToken, {
    type: 'flex',
    altText: '健やか整骨院 豊玉院 予約メニュー',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#2E7D6E',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '健やか整骨院 豊玉院', weight: 'bold', size: 'lg', color: '#ffffff' },
          { type: 'text', text: '予約・変更メニュー', size: 'sm', color: '#ffffffcc' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          flexButton('🆕 新規予約（初めての方）',  '🆕 新規予約（初めての方）'),
          flexButton('🗓️ 予約（来院中の方）',      '🗓️ 予約（来院中の方）'),
          flexButton('✏️ 予約変更・キャンセル',    '✏️ 予約変更・キャンセル'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        contents: [
          { type: 'text', text: '📞 03-5946-9959', size: 'sm', color: '#888888', align: 'center' },
          {
            type: 'text',
            text: '火〜金 9:30-13:00 / 15:00-19:00\n土 9:30-13:00 / 15:00-18:00\n定休：日・月',
            size: 'xs', color: '#aaaaaa', align: 'center', wrap: true,
          },
        ],
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════
//  ユーティリティ
// ══════════════════════════════════════════════════════════════
function flexButton(label, messageText) {
  return {
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: { type: 'message', label, text: messageText },
  };
}

function msg(text) {
  return { type: 'text', text };
}

async function safeReply(replyToken, text) {
  try {
    await lineClient.replyMessage(replyToken, msg(text));
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
//  サーバー起動
// ══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`[Server] ポート ${PORT} で起動しました`)
);
