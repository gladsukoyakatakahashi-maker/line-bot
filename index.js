require('dotenv').config();
/**
 * 整骨院 LINE予約ボット
 * LINE Messaging API (Node.js / Express)
 *
 * 必要パッケージ:
 *   npm install @line/bot-sdk express
 *
 * 環境変数 (.env):
 *   LINE_CHANNEL_SECRET=xxxx
 *   LINE_CHANNEL_ACCESS_TOKEN=xxxx
 */

const line = require('@line/bot-sdk');
const express = require('express');

// ─── 設定 ───────────────────────────────────────────────
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.Client(config);
const app = express();

// ─── 施術メニュー定義 ────────────────────────────────────
const MENUS = [
  { id: 'sekkotsu',   label: '骨格矯正・整復',   time: '30分', price: '3,000円' },
  { id: 'harikyu',    label: '鍼灸治療',          time: '45分', price: '4,500円' },
  { id: 'massage',    label: '筋肉調整マッサージ', time: '30分', price: '3,500円' },
  { id: 'rehab',      label: 'リハビリ運動療法',   time: '30分', price: '2,500円' },
  { id: 'course120',  label: '総合ケアコース',     time: '60分', price: '7,000円' },
];

// ─── ユーザーセッション（本番はRedis/DBへ）───────────────
const sessions = {};

function getSession(userId) {
  if (!sessions[userId]) sessions[userId] = { step: 'idle' };
  return sessions[userId];
}

// ─── Webhook エントリーポイント ────────────────────────
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => { console.error(err); res.status(500).end(); });
});

// ─── イベントルーティング ────────────────────────────────
async function handleEvent(event) {
  if (event.type === 'follow') return sendWelcome(event.replyToken);

  if (event.type === 'postback') return handlePostback(event);

  if (event.type === 'message' && event.message.type === 'text') {
    return handleText(event);
  }
}

// ─── テキストメッセージハンドラ ───────────────────────────
async function handleText(event) {
  const { replyToken, source: { userId }, message: { text } } = event;
  const session = getSession(userId);
  const t = text.trim();

  // キーワードでメインメニューに戻る
  if (['メニュー', 'menu', '最初', 'やり直し', 'ホーム'].includes(t)) {
    session.step = 'idle';
    return sendMainMenu(replyToken);
  }

  // セッションに応じた入力処理
  switch (session.step) {
    case 'await_name':
      session.name = t;
      session.step = 'await_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `${t} 様、ありがとうございます。\n次に、お電話番号を入力してください（例: 090-1234-5678）`,
      });

    case 'await_phone':
      session.phone = t;
      session.step = 'await_first_visit';
      return client.replyMessage(replyToken, makeFirstVisitSelect());

    case 'await_cancel_phone':
      return handleCancelSearch(replyToken, userId, t);

    default:
      return sendMainMenu(replyToken);
  }
}

// ─── ポストバックハンドラ ──────────────────────────────
async function handlePostback(event) {
  const { replyToken, source: { userId }, postback: { data } } = event;
  const session = getSession(userId);
  const params = new URLSearchParams(data);
  const action = params.get('action');

  switch (action) {
    case 'main_menu':
      session.step = 'idle';
      return sendMainMenu(replyToken);

    // ① 新規予約フロー
    case 'new_booking':
      session.step = 'select_date';
      session.booking = {};
      return client.replyMessage(replyToken, makeDatePicker());

    case 'select_date': {
      session.booking.date = params.get('date');
      session.step = 'select_time';
      return client.replyMessage(replyToken, makeTimePicker(session.booking.date));
    }

    case 'select_time': {
      session.booking.time = params.get('time');
      session.step = 'select_menu';
      return client.replyMessage(replyToken, makeMenuSelect());
    }

    case 'select_menu': {
      const menuId = params.get('menu');
      session.booking.menu = MENUS.find(m => m.id === menuId);
      session.step = 'await_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `「${session.booking.menu.label}」を選択しました。\n\nお名前をフルネームで入力してください。`,
      });
    }

    case 'first_visit': {
      session.booking.isFirst = params.get('val') === 'true';
      session.step = 'confirm_booking';
      return client.replyMessage(replyToken, makeBookingConfirm(session.booking));
    }

    case 'confirm_booking': {
      const confirmed = params.get('ok') === 'true';
      if (!confirmed) {
        session.step = 'idle';
        return sendMainMenu(replyToken);
      }
      // ここで実際のDB保存処理を行う
      const bookingId = saveBooking(session);
      session.step = 'idle';
      return client.replyMessage(replyToken, makeBookingComplete(session.booking, bookingId));
    }

    // ② 予約確認・変更・キャンセル
    case 'manage_booking':
      session.step = 'await_cancel_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: '予約を検索します。\nご登録のお電話番号を入力してください。',
      });

    case 'change_booking': {
      const bookingId = params.get('id');
      session.changingBookingId = bookingId;
      session.step = 'select_date';
      session.booking = { isChanging: true };
      return client.replyMessage(replyToken, [
        { type: 'text', text: '新しい日時を選択してください。' },
        makeDatePicker(),
      ]);
    }

    case 'cancel_booking': {
      const bookingId = params.get('id');
      return client.replyMessage(replyToken, makeCancelConfirm(bookingId));
    }

    case 'cancel_confirmed': {
      const bookingId = params.get('id');
      deleteBooking(bookingId);
      session.step = 'idle';
      return client.replyMessage(replyToken, [
        {
          type: 'text',
          text: `ご予約（番号: ${bookingId}）をキャンセルしました。\nまたのご利用をお待ちしております。`,
        },
        makeBackToMenuButton(),
      ]);
    }

    // ③ 施術メニュー案内
    case 'show_menus':
      return client.replyMessage(replyToken, makeMenuCarousel());

    case 'menu_detail': {
      const menuId = params.get('menu');
      const m = MENUS.find(x => x.id === menuId);
      return client.replyMessage(replyToken, makeMenuDetail(m));
    }

    default:
      return sendMainMenu(replyToken);
  }
}

// ─── ウェルカムメッセージ ──────────────────────────────
function sendWelcome(replyToken) {
  return client.replyMessage(replyToken, [
    {
      type: 'text',
      text: '🌿 はじめまして！\n○○整骨院のLINE予約窓口です。\n\nご予約・お問い合わせを承ります。',
    },
    makeMainMenuFlex(),
  ]);
}

function sendMainMenu(replyToken) {
  return client.replyMessage(replyToken, makeMainMenuFlex());
}

// ─── メッセージ生成ヘルパー ────────────────────────────

/** メインメニュー Flex Message */
function makeMainMenuFlex() {
  return {
    type: 'flex',
    altText: 'メインメニュー',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a6b5a',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '🏥 ○○整骨院', color: '#ffffff', size: 'xl', weight: 'bold' },
          { type: 'text', text: 'ご用件をお選びください', color: '#c8e6c9', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          makeMenuButton('① 新規予約', 'action=new_booking', '#1a6b5a'),
          makeMenuButton('② 予約確認・変更・取消', 'action=manage_booking', '#2c7a7b'),
          makeMenuButton('③ 施術メニュー・料金案内', 'action=show_menus', '#5c6bc0'),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📞 電話でのご予約: 0X-XXXX-XXXX', size: 'xs', color: '#888888', align: 'center' },
          { type: 'text', text: '営業時間: 月〜土 9:00〜19:00', size: 'xs', color: '#888888', align: 'center' },
        ],
      },
    },
  };
}

function makeMenuButton(label, data, color) {
  return {
    type: 'button',
    style: 'primary',
    color: color,
    action: { type: 'postback', label, data, displayText: label },
  };
}

/** 日付選択 (Quick Reply) */
function makeDatePicker() {
  const today = new Date();
  const dates = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() === 0) continue; // 日曜除外
    const m = d.getMonth() + 1, day = d.getDate();
    const wday = ['日','月','火','水','木','金','土'][d.getDay()];
    dates.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `${m}/${day}(${wday})`,
        data: `action=select_date&date=${d.toISOString().slice(0,10)}`,
        displayText: `${m}/${day}(${wday})を選択`,
      },
    });
  }
  return {
    type: 'text',
    text: '📅 ご希望の日付をお選びください（1週間以内）\n※日曜・祝日は休診です',
    quickReply: { items: dates },
  };
}

/** 時間選択 (Quick Reply) */
function makeTimePicker(date) {
  const slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
                 '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];
  return {
    type: 'text',
    text: `${date} のご希望時間をお選びください`,
    quickReply: {
      items: slots.slice(0, 13).map(t => ({
        type: 'action',
        action: {
          type: 'postback',
          label: t,
          data: `action=select_time&time=${t}`,
          displayText: `${t}を選択`,
        },
      })),
    },
  };
}

/** 施術メニュー選択 Flex */
function makeMenuSelect() {
  return {
    type: 'flex',
    altText: '施術メニューを選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '施術メニューを選択', weight: 'bold', size: 'lg' },
          ...MENUS.map(m => ({
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: `${m.label}（${m.time}/${m.price}）`,
              data: `action=select_menu&menu=${m.id}`,
            },
          })),
        ],
      },
    },
  };
}

/** 初診・再診選択 */
function makeFirstVisitSelect() {
  return {
    type: 'text',
    text: '初診・再診をお知らせください',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '初診（初めて）', data: 'action=first_visit&val=true', displayText: '初診です' } },
        { type: 'action', action: { type: 'postback', label: '再診（通院中）', data: 'action=first_visit&val=false', displayText: '再診です' } },
      ],
    },
  };
}

/** 予約確認 Flex */
function makeBookingConfirm(booking) {
  return {
    type: 'flex',
    altText: '予約内容の確認',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a',
        contents: [{ type: 'text', text: '📋 予約内容の確認', color: '#fff', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeInfoRow('日時', `${booking.date} ${booking.time}`),
          makeInfoRow('施術', booking.menu.label),
          makeInfoRow('時間', booking.menu.time),
          makeInfoRow('料金', booking.menu.price),
          makeInfoRow('お名前', `${booking.name} 様`),
          makeInfoRow('電話番号', booking.phone),
          makeInfoRow('区分', booking.isFirst ? '初診' : '再診'),
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '修正する', data: 'action=main_menu' } },
          { type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: '予約を確定する', data: 'action=confirm_booking&ok=true' } },
        ],
      },
    },
  };
}

function makeInfoRow(label, value) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888888', flex: 3 },
      { type: 'text', text: value, size: 'sm', flex: 5, wrap: true },
    ],
  };
}

/** 予約完了メッセージ */
function makeBookingComplete(booking, bookingId) {
  return {
    type: 'flex',
    altText: '予約が完了しました',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2e7d32',
        contents: [{ type: 'text', text: '✅ 予約が完了しました', color: '#fff', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeInfoRow('予約番号', bookingId),
          makeInfoRow('日時', `${booking.date} ${booking.time}`),
          makeInfoRow('施術', booking.menu.label),
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: '当日は5分前にお越しください。キャンセルは前日20時までにご連絡ください。',
            wrap: true, size: 'xs', color: '#888888',
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } },
        ],
      },
    },
  };
}

/** 施術メニュー Carousel */
function makeMenuCarousel() {
  return {
    type: 'flex',
    altText: '施術メニュー一覧',
    contents: {
      type: 'carousel',
      contents: MENUS.map(m => ({
        type: 'bubble',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a',
          contents: [
            { type: 'text', text: m.label, color: '#fff', weight: 'bold', size: 'md' },
          ],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            makeInfoRow('⏱ 時間', m.time),
            makeInfoRow('💴 料金', m.price),
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            {
              type: 'button', style: 'secondary',
              action: { type: 'postback', label: '詳細を見る', data: `action=menu_detail&menu=${m.id}` },
            },
            {
              type: 'button', style: 'primary', color: '#1a6b5a',
              action: { type: 'postback', label: 'このメニューで予約', data: 'action=new_booking', displayText: '新規予約を開始' },
            },
          ],
        },
      })),
    },
  };
}

/** 施術メニュー詳細 */
const MENU_DESCRIPTIONS = {
  sekkotsu: '骨格のゆがみや関節のズレを専門的な手技で整えます。肩こり・腰痛・猫背などにお勧めです。',
  harikyu: '鍼と灸を使って体内のエネルギーバランスを整えます。慢性痛・自律神経の乱れに効果的です。',
  massage: '筋肉の深部にアプローチし、疲れやコリをほぐします。全身リフレッシュにどうぞ。',
  rehab: '運動機能の回復・向上を目的としたリハビリプログラムです。怪我後の回復に最適です。',
  course120: '整復・マッサージ・ストレッチを組み合わせた当院の人気コースです。しっかりケアしたい方に。',
};

function makeMenuDetail(m) {
  return {
    type: 'flex',
    altText: m.label,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a',
        contents: [{ type: 'text', text: m.label, color: '#fff', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: MENU_DESCRIPTIONS[m.id], wrap: true, size: 'sm' },
          { type: 'separator' },
          makeInfoRow('⏱ 所要時間', m.time),
          makeInfoRow('💴 料金', m.price),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '← メニュー一覧に戻る', data: 'action=show_menus' } },
          { type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: 'このメニューで予約する', data: 'action=new_booking', displayText: '新規予約を開始' } },
        ],
      },
    },
  };
}

/** キャンセル確認 */
function makeCancelConfirm(bookingId) {
  return {
    type: 'flex',
    altText: 'キャンセルの確認',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '⚠️ キャンセルの確認', weight: 'bold' },
          { type: 'text', text: `予約番号 ${bookingId} をキャンセルします。\nよろしいですか？`, wrap: true, size: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '戻る', data: 'action=manage_booking' } },
          { type: 'button', style: 'primary', color: '#c0392b', action: { type: 'postback', label: 'キャンセルする', data: `action=cancel_confirmed&id=${bookingId}` } },
        ],
      },
    },
  };
}

/** メニューに戻るボタン */
function makeBackToMenuButton() {
  return {
    type: 'flex',
    altText: 'メニューに戻る',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } },
      ]},
    },
  };
}

/** キャンセル用の予約検索 */
async function handleCancelSearch(replyToken, userId, phone) {
  const session = getSession(userId);
  session.step = 'idle';
  // 実際はDBから検索する
  const dummyBookings = [
    { id: 'BK001', date: '2025-04-10', time: '10:00', menu: '骨格矯正・整復' },
  ];

  if (!dummyBookings.length) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: `電話番号 ${phone} の予約が見つかりませんでした。\n番号をご確認ください。`,
    });
  }

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '予約一覧',
    contents: {
      type: 'carousel',
      contents: dummyBookings.map(b => ({
        type: 'bubble',
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            { type: 'text', text: `予約番号: ${b.id}`, weight: 'bold' },
            makeInfoRow('日時', `${b.date} ${b.time}`),
            makeInfoRow('施術', b.menu),
          ],
        },
        footer: {
          type: 'box', layout: 'horizontal', spacing: 'sm',
          contents: [
            { type: 'button', style: 'secondary', action: { type: 'postback', label: '変更する', data: `action=change_booking&id=${b.id}` } },
            { type: 'button', style: 'primary', color: '#c0392b', action: { type: 'postback', label: 'キャンセル', data: `action=cancel_booking&id=${b.id}` } },
          ],
        },
      })),
    },
  });
}

// ─── DB スタブ（本番は実DBに置き換え）────────────────────
function saveBooking(session) {
  const id = 'BK' + Date.now().toString().slice(-6);
  console.log('予約保存:', { id, ...session.booking });
  return id;
}

function deleteBooking(bookingId) {
  console.log('予約削除:', bookingId);
}

// ─── サーバー起動 ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LINE Bot listening on port ${PORT}`));
