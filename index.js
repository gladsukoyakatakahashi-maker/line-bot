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
