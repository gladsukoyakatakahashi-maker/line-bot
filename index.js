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

app.get('/ping', (_req, res) => res.send('pong'));

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

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  try {
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

async function routeMenuSelection(userId, text, replyToken) {
  if (text.includes('新規予約')) {
    await setSession(userId, { type: 'new', step: 'await_datetime' });
    return lineClient.replyMessage(replyToken, msg(
      '📅 ご希望の日時を入力してください。\n例）6月10日 午前10時ごろ'
    ));
  }

  if (text.includes('予約（来院中の方）')) {
    await setSession(userId, { type: 'revisit', step: 'await_datetime' });
    return lineClient.replyMessage(replyToken, msg(
      '📅 ご希望の日時を入力してください。\n例）6月10日 午前10時ごろ'
    ));
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

  // どのワードが来てもメニューを表示
  return sendMenu(replyToken);
}

async function continueFlow(userId, text, session, replyToken) {
  switch (session.step) {

    case 'await_datetime':
      session.datetime = text;
      session.step = 'await_phone';
      await setSession(userId, session);
      return lineClient.replyMessage(replyToken, msg(
        '📱 電話番号を入力してください。\n例）090-1234-5678'
      ));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`[Server] ポート ${PORT} で起動しました`)
);
