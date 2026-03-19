require('dotenv').config();

const line = require('@line/bot-sdk');
const express = require('express');

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.Client(config);
const app = express();

const CLINIC = {
  name: '健やか整骨院 豊玉',
  tel: '03-5946-9959',
  hours: '火〜金 9:30〜12:10 / 15:00〜19:00\n土 9:30〜12:10 / 15:00〜17:40',
  closed: '日・月・祝日',
};

const MENUS = [
  { id: 'shinkan',  label: '新患施術',             time: '60〜90分', price: '初回カウンセリング込み', needsDetail: true },
  { id: 'ippan',    label: '一般施術',             time: '40分',     price: '施術内容により異なる',   needsDetail: true },
  { id: 'kotsuban', label: '骨盤矯正',             time: '40分',     price: '3,300円',               needsDetail: false },
  { id: 'nekoze',   label: '猫背矯正',             time: '40分',     price: '2,750円',               needsDetail: false },
  { id: 'stretch',  label: '下肢ストレッチ',       time: '40分',     price: '2,750円',               needsDetail: false },
  { id: 'personal', label: 'パーソナルトレーニング', time: '40分',   price: '4,950円',               needsDetail: false },
  { id: 'rehab',    label: 'リハビリ',             time: '40分',     price: '4,950円',               needsDetail: false },
];

const OPEN_DAYS = [2, 3, 4, 5, 6];

const SLOTS = {
  weekday:  ['09:30','10:10','10:50','11:30','15:00','15:40','16:20','17:00','17:40','18:20'],
  saturday: ['09:30','10:10','10:50','11:30','15:00','15:40','16:20','17:00'],
};

const sessions = {};
function getSession(userId) {
  if (!sessions[userId]) sessions[userId] = { step: 'idle' };
  return sessions[userId];
}

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => { console.error(err); res.status(500).end(); });
});

async function handleEvent(event) {
  if (event.type === 'follow') return sendWelcome(event.replyToken);
  if (event.type === 'postback') return handlePostback(event);
  if (event.type === 'message' && event.message.type === 'text') return handleText(event);
}

async function handleText(event) {
  const { replyToken, source: { userId }, message: { text } } = event;
  const session = getSession(userId);
  const t = text.trim();

  if (['メニュー','menu','最初','やり直し','ホーム','トップ'].includes(t)) {
    session.step = 'idle';
    return sendMainMenu(replyToken);
  }

  switch (session.step) {
    case 'await_name':
      session.name = t;
      session.step = 'await_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `${t} 様、ありがとうございます。\nお電話番号を入力してください。\n例）03-5946-0000`,
      });

    case 'await_phone':
      session.phone = t;
      if (session.booking.menu && session.booking.menu.needsDetail) {
        session.step = 'await_menu_detail';
        return client.replyMessage(replyToken, {
          type: 'text',
          text: '希望の施術内容をご記入ください。\n例）腰痛、肩こり、交通事故後のリハビリ など',
        });
      }
      session.step = 'await_first_visit';
      return client.replyMessage(replyToken, makeFirstVisitSelect());

    case 'await_menu_detail':
      session.booking.menuDetail = t;
      session.step = 'await_first_visit';
      return client.replyMessage(replyToken, makeFirstVisitSelect());

    case 'await_cancel_phone':
      return handleCancelSearch(replyToken, userId, t);

    default:
      return sendMainMenu(replyToken);
  }
}

async function handlePostback(event) {
  const { replyToken, source: { userId }, postback: { data } } = event;
  const session = getSession(userId);
  const params = new URLSearchParams(data);
  const action = params.get('action');

  switch (action) {
    case 'main_menu':
      session.step = 'idle';
      return sendMainMenu(replyToken);

    case 'new_booking':
      session.step = 'select_date';
      session.booking = {};
      return client.replyMessage(replyToken, makeDatePicker());

    case 'select_date':
      session.booking.date = params.get('date');
      session.booking.dayOfWeek = parseInt(params.get('dow'));
      session.step = 'select_time';
      return client.replyMessage(replyToken, makeTimePicker(session.booking.date, session.booking.dayOfWeek));

    case 'select_time':
      session.booking.time = params.get('time');
      session.step = 'select_menu';
      return client.replyMessage(replyToken, makeMenuSelect());

    case 'select_menu': {
      const menuId = params.get('menu');
      session.booking.menu = MENUS.find(m => m.id === menuId);
      session.step = 'await_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `「${session.booking.menu.label}」を選択しました。\n\nお名前をフルネームで入力してください。\n例）山田 太郎`,
      });
    }

    case 'first_visit':
      session.booking.isFirst = params.get('val') === 'true';
      session.step = 'confirm_booking';
      return client.replyMessage(replyToken, makeBookingConfirm(session.booking));

    case 'confirm_booking': {
      if (params.get('ok') !== 'true') {
        session.step = 'idle';
        return sendMainMenu(replyToken);
      }
      const bookingId = saveBooking(session);
      session.step = 'idle';
      return client.replyMessage(replyToken, makeBookingComplete(session.booking, bookingId));
    }

    case 'manage_booking':
      session.step = 'await_cancel_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: 'ご登録のお電話番号を入力してください。\n予約を検索します。',
      });

    case 'change_booking':
      session.changingBookingId = params.get('id');
      session.step = 'select_date';
      session.booking = { isChanging: true };
      return client.replyMessage(replyToken, [
        { type: 'text', text: '新しい日時を選択してください。' },
        makeDatePicker(),
      ]);

    case 'cancel_booking':
      return client.replyMessage(replyToken, makeCancelConfirm(params.get('id')));

    case 'cancel_confirmed':
      deleteBooking(params.get('id'));
      session.step = 'idle';
      return client.replyMessage(replyToken, [
        { type: 'text', text: `予約番号 ${params.get('id')} をキャンセルしました。\nまたのご来院をお待ちしております。` },
        makeBackToMenuFlex(),
      ]);

    case 'show_menus':
      return client.replyMessage(replyToken, makeMenuCarousel());

    case 'menu_detail': {
      const m = MENUS.find(x => x.id === params.get('menu'));
      return client.replyMessage(replyToken, makeMenuDetail(m));
    }

    default:
      return sendMainMenu(replyToken);
  }
}

function sendWelcome(replyToken) {
  return client.replyMessage(replyToken, [
    { type: 'text', text: `🌿 はじめまして！\n${CLINIC.name}のLINE予約窓口です。\n\nご予約・お問い合わせをお気軽にどうぞ。` },
    makeMainMenuFlex(),
  ]);
}

function sendMainMenu(replyToken) {
  return client.replyMessage(replyToken, makeMainMenuFlex());
}

function makeMainMenuFlex() {
  return {
    type: 'flex',
    altText: 'メインメニュー',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', paddingAll: '20px',
        contents: [
          { type: 'text', text: `🏥 ${CLINIC.name}`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'ご用件をお選びください', color: '#c8e6c9', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          makeMenuButton('① 新規予約', 'action=new_booking', '#1a6b5a'),
          makeMenuButton('② 予約確認・変更・取消', 'action=manage_booking', '#2c7a7b'),
          makeMenuButton('③ 施術メニュー・料金案内', 'action=show_menus', '#5c6bc0'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#888888', align: 'center' },
          { type: 'text', text: `営業：${CLINIC.hours}`, size: 'xs', color: '#888888', align: 'center', wrap: true },
          { type: 'text', text: `休院：${CLINIC.closed}`, size: 'xs', color: '#888888', align: 'center' },
        ],
      },
    },
  };
}

function makeMenuButton(label, data, color) {
  return { type: 'button', style: 'primary', color, action: { type: 'postback', label, data, displayText: label } };
}

function makeDatePicker() {
  const today = new Date();
  const items = [];
  const dayNames = ['日','月','火','水','木','金','土'];
  for (let i = 1; i <= 14 && items.length < 10; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = d.getDay();
    if (!OPEN_DAYS.includes(dow)) continue;
    const m = d.getMonth() + 1, day = d.getDate();
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `${m}/${day}(${dayNames[dow]})`,
        data: `action=select_date&date=${d.toISOString().slice(0,10)}&dow=${dow}`,
        displayText: `${m}/${day}(${dayNames[dow]})を希望`,
      },
    });
  }
  return { type: 'text', text: '📅 ご希望の日付をお選びください\n※日・月・祝日は休院です', quickReply: { items } };
}

function makeTimePicker(date, dow) {
  const slots = dow === 6 ? SLOTS.saturday : SLOTS.weekday;
  return {
    type: 'text',
    text: `${date} のご希望時間をお選びください`,
    quickReply: {
      items: slots.map(t => ({
        type: 'action',
        action: { type: 'postback', label: t, data: `action=select_time&time=${t}`, displayText: `${t}を希望` },
      })),
    },
  };
}

function makeMenuSelect() {
  return {
    type: 'flex', altText: '施術メニューを選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '施術メニューを選択', weight: 'bold', size: 'lg', margin: 'none' },
          { type: 'separator', margin: 'md' },
          ...MENUS.map(m => ({
            type: 'button', style: 'secondary', margin: 'sm',
            action: { type: 'postback', label: `${m.label}（${m.time}）`, data: `action=select_menu&menu=${m.id}` },
          })),
        ],
      },
    },
  };
}

function makeFirstVisitSelect() {
  return {
    type: 'text', text: '初診・再診をお選びください',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '初診（初めて）', data: 'action=first_visit&val=true', displayText: '初診です' } },
        { type: 'action', action: { type: 'postback', label: '再診（通院中）', data: 'action=first_visit&val=false', displayText: '再診です' } },
      ],
    },
  };
}

function makeBookingConfirm(booking) {
  const rows = [
    makeInfoRow('日時', `${booking.date} ${booking.time}`),
    makeInfoRow('施術', booking.menu.label),
    makeInfoRow('料金', booking.menu.price),
    makeInfoRow('お名前', `${booking.name} 様`),
    makeInfoRow('電話番号', booking.phone),
    makeInfoRow('区分', booking.isFirst ? '初診' : '再診'),
  ];
  if (booking.menuDetail) rows.push(makeInfoRow('ご要望', booking.menuDetail));
  return {
    type: 'flex', altText: '予約内容の確認',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: '📋 予約内容の確認', color: '#fff', weight: 'bold' }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
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

function makeBookingComplete(booking, bookingId) {
  return {
    type: 'flex', altText: '予約が完了しました',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#2e7d32', contents: [{ type: 'text', text: '✅ 予約が完了しました', color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeInfoRow('予約番号', bookingId),
          makeInfoRow('日時', `${booking.date} ${booking.time}`),
          makeInfoRow('施術', booking.menu.label),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '当日は5分前にお越しください。\nキャンセルは前日までにご連絡ください。', wrap: true, size: 'xs', color: '#888888' },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#1a6b5a', margin: 'sm' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } }],
      },
    },
  };
}

function makeMenuCarousel() {
  return {
    type: 'flex', altText: '施術メニュー一覧',
    contents: {
      type: 'carousel',
      contents: MENUS.map(m => ({
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: m.label, color: '#fff', weight: 'bold', size: 'md', wrap: true }] },
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [
            makeInfoRow('⏱ 時間', m.time),
            makeInfoRow('💴 料金', m.price),
            ...(m.needsDetail ? [{ type: 'text', text: '※ご予約後に希望施術内容を入力いただきます', size: 'xxs', color: '#888888', wrap: true, margin: 'sm' }] : []),
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm',
          contents: [{ type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: 'このメニューで予約', data: 'action=new_booking', displayText: '新規予約を開始' } }],
        },
      })),
    },
  };
}

const MENU_DESCRIPTIONS = {
  shinkan:  '初めてご来院の方向けです。問診・検査・施術を含む丁寧なカウンセリングを行います（60〜90分）。',
  ippan:    '通院中の方向けの施術です。ご予約時に希望施術内容をお知らせください。',
  kotsuban: '骨盤のゆがみを整え、腰痛・産後の不調・姿勢改善に効果的です。',
  nekoze:   '背骨・肩甲骨まわりを整え、猫背・肩こり・首こりの改善を目指します。',
  stretch:  '下肢の筋肉・関節をほぐし、股関節・膝・足首の可動域を広げます。',
  personal: 'お身体の状態に合わせたオーダーメイドのトレーニング指導を行います。',
  rehab:    'ケガや術後の回復をサポートする運動療法・リハビリプログラムです。',
};

function makeMenuDetail(m) {
  return {
    type: 'flex', altText: m.label,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: m.label, color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: MENU_DESCRIPTIONS[m.id], wrap: true, size: 'sm' },
          { type: 'separator' },
          makeInfoRow('⏱ 時間', m.time),
          makeInfoRow('💴 料金', m.price),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '← メニュー一覧', data: 'action=show_menus' } },
          { type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: 'このメニューで予約', data: 'action=new_booking', displayText: '新規予約を開始' } },
        ],
      },
    },
  };
}

function makeCancelConfirm(bookingId) {
  return {
    type: 'flex', altText: 'キャンセルの確認',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '⚠️ キャンセルの確認', weight: 'bold' },
          { type: 'text', text: `予約番号 ${bookingId} をキャンセルします。よろしいですか？`, wrap: true, size: 'sm' },
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

function makeBackToMenuFlex() {
  return {
    type: 'flex', altText: 'メニューに戻る',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } }] },
    },
  };
}

async function handleCancelSearch(replyToken, userId, phone) {
  const session = getSession(userId);
  session.step = 'idle';
  const dummyBookings = [
    { id: 'BK001', date: '2026-03-25', time: '10:10', menu: '骨盤矯正' },
  ];
  if (!dummyBookings.length) {
    return client.replyMessage(replyToken, { type: 'text', text: `電話番号 ${phone} の予約が見つかりませんでした。\n📞 ${CLINIC.tel}` });
  }
  return client.replyMessage(replyToken, {
    type: 'flex', altText: '予約一覧',
    contents: {
      type: 'carousel',
      contents: dummyBookings.map(b => ({
        type: 'bubble',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: `予約番号: ${b.id}`, weight: 'bold' },
          makeInfoRow('日時', `${b.date} ${b.time}`),
          makeInfoRow('施術', b.menu),
        ]},
        footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '変更する', data: `action=change_booking&id=${b.id}` } },
          { type: 'button', style: 'primary', color: '#c0392b', action: { type: 'postback', label: 'キャンセル', data: `action=cancel_booking&id=${b.id}` } },
        ]},
      })),
    },
  });
}

function saveBooking(session) {
  const id = 'BK' + Date.now().toString().slice(-6);
  console.log('予約保存:', { id, ...session.booking });
  return id;
}

function deleteBooking(bookingId) {
  console.log('予約削除:', bookingId);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${CLINIC.name} LINE Bot listening on port ${PORT}`));
