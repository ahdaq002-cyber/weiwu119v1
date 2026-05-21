const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8787;
const ROOT = path.resolve(__dirname);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf'
};

const SOURCES = {
  nfaLaw: 'https://law.nfa.gov.tw/MOBILE/default.aspx?type=all',
  mojLaw: 'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0120025',
  ghs: 'https://ghs.osha.gov.tw/CHT/intro/search.aspx',
  cha: 'https://www.cha.gov.tw/sp-toch-list-1.html?query=&type=1',
  unece: 'https://unece.org/DAM/trans/danger/publi/unrec/English/part3.pdf',
  pubchem: 'https://pubchem.ncbi.nlm.nih.gov/',
  comptox: 'https://comptox.epa.gov/dashboard/'
};

const UN_HINTS = {
  '1090': { name: '丙酮', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1170': { name: '乙醇或乙醇溶液', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1203': { name: '汽油', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1219': { name: '異丙醇', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1263': { name: '油漆或油漆相關材料', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1950': { name: '噴霧罐', classText: '第2類氣體', fireDirection: '可燃性高壓氣體或噴霧罐方向' },
  '1965': { name: '液化石油氣/烴類混合氣', classText: '第2類氣體', fireDirection: '液化石油氣或可燃性高壓氣體方向' },
  '1993': { name: '易燃液體泛用項目', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1866': { name: '樹脂溶液', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' },
  '1133': { name: '黏著劑', classText: '第3類易燃液體', fireDirection: '公共危險物品第四類方向' }
};

const KEYWORDS = [
  { kind: 'lpg', label: '可燃性高壓氣體/LPG', terms: ['液化石油氣', 'lpg', '瓦斯', 'propane', 'butane', '丙烷', '丁烷', '瓦斯罐', '鋼瓶'] },
  { kind: 'firework', label: '爆竹煙火', terms: ['爆竹', '煙火', 'firework', 'firecracker', 'pyrotechnic', '仙女棒', '鞭炮', '沖天炮', '專業煙火'] },
  { kind: 'hazmat', label: '公共危險物品', terms: ['汽油', 'gasoline', 'petrol', '酒精', 'ethanol', '甲醇', 'methanol', '丙酮', 'acetone', '異丙醇', 'isopropanol', 'ipa', '香蕉水', '甲苯', 'toluene', '二甲苯', 'xylene', '稀釋劑', 'thinner', '油漆', 'paint', '黏著劑', 'adhesive', '去漬油', '煤油', 'kerosene'] },
  { kind: 'oxidizer', label: '氧化性公共危險物品', terms: ['氧化劑', 'oxidizer', '過氧化', 'peroxide', '硝酸', 'nitrate', '氯酸', 'chlorate', '過錳酸', 'permanganate'] },
  { kind: 'other', label: '其他機關或跨機關', terms: ['農藥', 'pesticide', '藥品', '消毒水', 'bleach', '漂白水', '鹽酸', 'hydrochloric acid', '氫氧化鈉', 'sodium hydroxide'] }
];

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function clean(value) {
  return String(value || '').trim();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractUn(text) {
  const found = [];
  const re = /\bUN\s*[-:]?\s*(\d{4})\b|\b(\d{4})\b/gi;
  let match;
  while ((match = re.exec(text))) {
    const no = match[1] || match[2];
    if (UN_HINTS[no]) found.push(no);
  }
  return uniq(found);
}

function extractCas(text) {
  const matches = text.match(/\b\d{2,7}-\d{2}-\d\b/g);
  return uniq(matches || []);
}

function keywordSignals(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.map(item => {
    const hits = item.terms.filter(term => lower.includes(term.toLowerCase()));
    return hits.length ? { source: '內建關鍵字', kind: item.kind, label: item.label, hits } : null;
  }).filter(Boolean);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'mydetagg-label-check/1.0' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function queryPubChem(input) {
  const q = clean(input.casNo) || clean(input.productName);
  if (!q) return { ok: false, message: '未提供品名或 CAS，略過 PubChem。' };
  const encoded = encodeURIComponent(q);
  const cidUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/cids/JSON`;
  try {
    const cidData = await fetchJson(cidUrl);
    const cid = cidData.IdentifierList && cidData.IdentifierList.CID && cidData.IdentifierList.CID[0];
    if (!cid) return { ok: false, message: 'PubChem 查無 CID。', url: `https://pubchem.ncbi.nlm.nih.gov/#query=${encoded}` };
    const props = [
      'Title',
      'MolecularFormula',
      'MolecularWeight',
      'CanonicalSMILES',
      'IsomericSMILES',
      'IUPACName'
    ].join(',');
    const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/${props}/JSON`;
    const propData = await fetchJson(propUrl);
    const row = propData.PropertyTable && propData.PropertyTable.Properties && propData.PropertyTable.Properties[0];
    return {
      ok: true,
      source: 'PubChem（美國 NIH）',
      cid,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
      title: row && row.Title,
      formula: row && row.MolecularFormula,
      molecularWeight: row && row.MolecularWeight,
      iupacName: row && row.IUPACName
    };
  } catch (error) {
    return { ok: false, message: `PubChem 查詢失敗：${error.message}`, url: `https://pubchem.ncbi.nlm.nih.gov/#query=${encoded}` };
  }
}

function buildAssessment(input, signals, pubchem) {
  const kinds = uniq(signals.map(s => s.kind));
  let status = '資料不足，不能判斷是否屬消防主管危險物品。';
  let level = 'need';
  if (kinds.includes('hazmat') || kinds.includes('oxidizer')) {
    status = '疑似公共危險物品方向，需補業者 SDS 後再對照法規分類、分級與管制量。';
    level = 'watch';
  }
  if (kinds.includes('lpg')) {
    status = '疑似液化石油氣或可燃性高壓氣體方向，需確認氣體種類、容器規格、總儲氣量、用途與放置位置。';
    level = 'likely';
  }
  if (kinds.includes('firework')) {
    status = '疑似爆竹煙火方向，需確認品項、火藥量、認可標示、數量與持有人。';
    level = 'likely';
  }
  if (!signals.length && (input.productName || input.casNo || input.unNo || input.labelText)) {
    status = '目前未查到明顯消防主管線索；仍不得直接排除，建議要求業者提出 SDS 或佐證資料。';
    level = 'low';
  }
  if (input.vendorSds === 'provided') status += ' 已有業者 SDS 時，請以業者 SDS 作正式比對基礎。';
  if (input.vendorSds === 'refused') status += ' 業者拒絕或無法提出資料時，請保留要求提供資料的程序紀錄。';

  const missing = [];
  if (!input.productName && !input.labelText) missing.push('品名或標籤文字');
  if (!input.amount) missing.push('現場數量或容量');
  if (!input.state || input.state === 'unknown') missing.push('物品外觀狀態');
  if (!input.casNo) missing.push('CAS No.（有會提高準確性）');
  if (!input.unNo) missing.push('UN No.（有會提高準確性）');
  if (input.vendorSds !== 'provided') missing.push('業者提供 SDS');

  const nextSteps = [
    '請以業者 SDS、實物標籤、現場數量與儲存/使用情境作正式判定基礎。',
    '若疑似公共危險物品，取得 SDS 後再依附表一對照類別、分級、管制量。',
    '疑義案件請查消防署法令查詢系統及函釋，避免單看條文造成誤判。'
  ];

  if (pubchem && pubchem.ok) {
    nextSteps.push('PubChem 只用來確認化學品身分線索，不得取代業者 SDS。');
  }

  return { status, level, missing, nextSteps };
}

async function analyze(payload) {
  const input = {
    productName: clean(payload.productName),
    maker: clean(payload.maker),
    casNo: clean(payload.casNo),
    unNo: clean(payload.unNo),
    labelText: clean(payload.labelText),
    amount: clean(payload.amount),
    state: clean(payload.state),
    vendorSds: clean(payload.vendorSds),
    sceneNote: clean(payload.sceneNote)
  };
  const text = [
    input.productName,
    input.maker,
    input.casNo,
    input.unNo,
    input.labelText,
    input.amount,
    input.state,
    input.sceneNote
  ].join(' ');
  const casFound = extractCas(text);
  const unFound = extractUn(text);
  if (!input.casNo && casFound.length) input.casNo = casFound[0];
  if (!input.unNo && unFound.length) input.unNo = `UN ${unFound[0]}`;

  const signals = keywordSignals(text);
  unFound.forEach(no => {
    const hint = UN_HINTS[no];
    signals.push({
      source: 'UNECE UN Dangerous Goods List 對照線索',
      kind: no === '1965' || no === '1950' ? 'lpg' : 'hazmat',
      label: `UN ${no}`,
      hits: [`${hint.name}，${hint.classText}，${hint.fireDirection}`],
      url: SOURCES.unece
    });
  });

  const pubchem = await queryPubChem(input);
  const assessment = buildAssessment(input, signals, pubchem);
  const searchTerms = uniq([input.productName, input.casNo, input.unNo, input.maker]).join(' ');

  return {
    input,
    assessment,
    signals,
    remoteResults: [
      pubchem,
      {
        ok: true,
        source: '職安署 GHS 化學品資料庫',
        message: '需人工輸入品名或 CAS 查詢；其資料不得取代事業單位 SDS。',
        url: SOURCES.ghs
      },
      {
        ok: true,
        source: '環境部化學物質管理署',
        message: '可用 CAS 或名稱確認是否另涉毒性及關注化學物質。',
        url: SOURCES.cha
      },
      {
        ok: true,
        source: '消防署法令查詢系統',
        message: '用於查現行函釋與消防實務，不是商品品名資料庫。',
        url: SOURCES.nfaLaw
      },
      {
        ok: true,
        source: '全國法規資料庫',
        message: '用於確認現行法規條文；附表一是分類與管制量對照，不是商品身分資料庫。',
        url: SOURCES.mojLaw
      },
      {
        ok: true,
        source: 'EPA CompTox',
        message: '可輔助確認化學品身分與資料，但不屬台灣裁罰依據。',
        url: searchTerms ? `https://comptox.epa.gov/dashboard/chemical/search-results?search=${encodeURIComponent(searchTerms)}` : SOURCES.comptox
      }
    ],
    generatedAt: new Date().toISOString()
  };
}

function serveFile(req, res) {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/') pathname = '/危險物品標籤初判.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, { ok: true, service: '危險物品標籤查詢服務', port: PORT });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/analyze') {
    try {
      const payload = JSON.parse(await readBody(req) || '{}');
      sendJson(res, 200, await analyze(payload));
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }
  if (req.method === 'GET') {
    serveFile(req, res);
    return;
  }
  sendJson(res, 405, { ok: false, error: 'Method not allowed' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`危險物品標籤查詢服務已啟動：http://127.0.0.1:${PORT}/危險物品標籤初判.html`);
});
