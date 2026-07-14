const PRODUCT_SHEET = '商品一覧';
const VARIANT_SHEET = 'カラー在庫';
const OPTION_SHEET = '追加オプション';
const UNIFIED_SHEET = '商品管理';
const CATEGORY_SHEET = '商品タブ';
const SETTINGS_SHEET = '設定';
const DATA_SHEET = 'HP商品データ';
const IMAGE_FOLDER_NAME = 'andtete商品画像';
const JSON_CHUNK_SIZE = 45000;

function setupProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const token = getWriteToken_() || Utilities.getUuid().replace(/-/g, '');

  writeSettings_(token);
  const unifiedSheet = ensureSheet_(UNIFIED_SHEET, unifiedHeaders_());
  ensureSheet_(CATEGORY_SHEET, categoryHeaders_());
  ensureSheet_(DATA_SHEET, ['JSON']);

  if (unifiedSheet.getLastRow() < 2) migrateLegacySheets_();
  hideLegacySheets_();

  const dataSheet = spreadsheet.getSheetByName(DATA_SHEET);
  if (dataSheet && !dataSheet.isSheetHidden()) dataSheet.hideSheet();

  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(UNIFIED_SHEET));
  return token;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = parseSyncPayload_(e);
    const expectedToken = getWriteToken_();
    if (!expectedToken || String(payload.token || '') !== expectedToken) {
      return jsonOutput_({ ok: false, error: '管理用同期キーが正しくありません。' });
    }

    const products = Array.isArray(payload.products) ? payload.products : [];
    const categories = normalizeCategories_(payload.categories);
    const publishedProducts = saveUploadedImages_(products);

    writeUnifiedSheet_(publishedProducts, categories);
    writeHiddenData_({ products: publishedProducts, categories: categories });

    return jsonOutput_({ ok: true, count: publishedProducts.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function parseSyncPayload_(e) {
  const parameterPayload = e && e.parameter ? String(e.parameter.payload || '') : '';
  if (parameterPayload) return JSON.parse(parameterPayload);

  const raw = String((e && e.postData && e.postData.contents) || '').trim();
  if (!raw) return {};
  if (raw.charAt(0) === '{' || raw.charAt(0) === '[') return JSON.parse(raw);

  const decoded = decodeFormBody_(raw);
  if (decoded.payload) return JSON.parse(decoded.payload);
  return decoded;
}

function decodeFormBody_(body) {
  return body.split('&').reduce(function(result, pair) {
    if (!pair) return result;
    const parts = pair.split('=');
    const key = decodeURIComponent(String(parts.shift() || '').replace(/\+/g, ' '));
    const value = decodeURIComponent(String(parts.join('=') || '').replace(/\+/g, ' '));
    result[key] = value;
    return result;
  }, {});
}

function doGet(e) {
  const action = e && e.parameter ? String(e.parameter.action || '') : '';
  if (action === 'checkout') return createCheckoutResponse_(e);

  const data = readProductsFromSheets_();
  const payload = JSON.stringify({
    ok: true,
    products: data.products,
    categories: data.categories,
    updatedAt: new Date().toISOString()
  });
  const callback = e && e.parameter ? String(e.parameter.callback || '') : '';

  if (/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function createCheckoutResponse_(e) {
  const callback = e && e.parameter ? String(e.parameter.callback || '') : '';
  const result = createCheckoutSession_(e && e.parameter ? e.parameter : {});
  const payload = JSON.stringify(result);

  if (/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function createCheckoutSession_(params) {
  try {
    const secretKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
    if (!secretKey) return { ok: false, error: 'Stripe秘密鍵が未設定です。' };

    if (params.cart) return createCartCheckoutSession_(params, secretKey);

    const productId = String(params.productId || '').trim();
    const variantName = String(params.variant || '').trim();
    const optionNames = splitList_(params.options || '');
    const quantity = Math.max(1, Math.min(20, Number(params.quantity || 1)));
    const successUrl = safeReturnUrl_(params.successUrl || '');
    const cancelUrl = safeReturnUrl_(params.cancelUrl || '');
    const data = readProductsFromSheets_();
    const product = data.products.find(function(item) {
      return String(item.id || '') === productId && item.visible !== false;
    });

    if (!product) return { ok: false, error: '商品が見つかりません。' };

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selectedVariant = variantName
      ? variants.find(function(variant) { return String(variant.name || '') === variantName; })
      : variants[0];
    const stock = variants.length ? Number(selectedVariant && selectedVariant.stock || 0) : Number(product.stock || 0);
    if (variants.length && !selectedVariant) return { ok: false, error: 'カラーが見つかりません。' };
    if (stock <= 0) return { ok: false, error: '在庫がありません。' };

    const selectedOptions = (Array.isArray(product.options) ? product.options : []).filter(function(option) {
      return optionNames.indexOf(String(option.name || '')) >= 0;
    });
    const optionsTotal = selectedOptions.reduce(function(sum, option) {
      return sum + Math.max(0, Number(option.priceAdjustment || 0));
    }, 0);
    const unitAmount = Math.max(0, Number(product.price || 0)) + optionsTotal;
    if (unitAmount <= 0) return { ok: false, error: '価格が正しくありません。' };

    const displayName = product.name + (selectedVariant ? ' / ' + selectedVariant.name : '');
    const descriptionParts = selectedOptions.map(function(option) { return option.name; });
    const request = {
      'mode': 'payment',
      'success_url': successUrl,
      'cancel_url': cancelUrl,
      'line_items[0][quantity]': String(quantity),
      'line_items[0][price_data][currency]': 'jpy',
      'line_items[0][price_data][product_data][name]': displayName,
      'line_items[0][price_data][unit_amount]': String(unitAmount),
      'metadata[product_id]': productId,
      'metadata[product_name]': product.name,
      'metadata[variant]': selectedVariant ? selectedVariant.name : '',
      'metadata[options]': descriptionParts.join(', ')
    };

    if (descriptionParts.length) {
      request['line_items[0][price_data][product_data][description]'] = '追加オプション: ' + descriptionParts.join(', ');
    }

    const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Stripe-Version': '2026-02-25.clover'
      },
      payload: request,
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = JSON.parse(response.getContentText() || '{}');
    if (code < 200 || code >= 300 || !body.url) {
      return { ok: false, error: body.error && body.error.message ? body.error.message : 'Stripe決済画面を作成できませんでした。' };
    }
    return { ok: true, url: body.url };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function createCartCheckoutSession_(params, secretKey) {
  const successUrl = safeReturnUrl_(params.successUrl || '');
  const cancelUrl = safeReturnUrl_(params.cancelUrl || '');
  const cart = parseCart_(params.cart);
  if (!cart.length) return { ok: false, error: 'かごの中身が空です。' };

  const data = readProductsFromSheets_();
  const lineItems = [];
  const metadataNames = [];

  cart.slice(0, 30).forEach(function(item, index) {
    const product = data.products.find(function(row) {
      return String(row.id || '') === String(item.productId || '') && row.visible !== false;
    });
    if (!product) throw new Error('商品が見つかりません: ' + String(item.productId || ''));

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const variantName = String(item.variant || '').trim();
    const selectedVariant = variantName
      ? variants.find(function(variant) { return String(variant.name || '') === variantName; })
      : variants[0];
    if (variants.length && !selectedVariant) throw new Error(product.name + ' のカラーが見つかりません。');

    const stock = variants.length ? Number(selectedVariant.stock || 0) : Number(product.stock || 0);
    const quantity = Math.max(1, Math.min(20, Number(item.quantity || 1)));
    if (stock < quantity) throw new Error(product.name + ' の在庫が足りません。');

    const requestedOptions = Array.isArray(item.options) ? item.options.map(String) : splitList_(item.options || '');
    const selectedOptions = (Array.isArray(product.options) ? product.options : []).filter(function(option) {
      return requestedOptions.indexOf(String(option.name || '')) >= 0;
    });
    const optionTotal = selectedOptions.reduce(function(sum, option) {
      return sum + Math.max(0, Number(option.priceAdjustment || 0));
    }, 0);
    const unitAmount = Math.max(0, Number(product.price || 0)) + optionTotal;
    if (unitAmount <= 0) throw new Error(product.name + ' の価格が正しくありません。');

    const name = product.name + (selectedVariant ? ' / ' + selectedVariant.name : '');
    const description = selectedOptions.length ? '追加オプション: ' + selectedOptions.map(function(option) { return option.name; }).join(', ') : '';
    addLineItem_(lineItems, index, name, unitAmount, quantity, description);
    metadataNames.push(name + ' x' + quantity);
  });

  const request = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[cart_items]': metadataNames.join(' / ').slice(0, 500)
  };
  lineItems.forEach(function(entry) {
    request[entry.key] = entry.value;
  });

  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + secretKey,
      'Stripe-Version': '2026-02-25.clover'
    },
    payload: request,
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const body = JSON.parse(response.getContentText() || '{}');
  if (code < 200 || code >= 300 || !body.url) {
    return { ok: false, error: body.error && body.error.message ? body.error.message : 'Stripe決済画面を作成できませんでした。' };
  }
  return { ok: true, url: body.url };
}

function addLineItem_(lineItems, index, name, unitAmount, quantity, description) {
  lineItems.push({ key: 'line_items[' + index + '][quantity]', value: String(quantity) });
  lineItems.push({ key: 'line_items[' + index + '][price_data][currency]', value: 'jpy' });
  lineItems.push({ key: 'line_items[' + index + '][price_data][unit_amount]', value: String(unitAmount) });
  lineItems.push({ key: 'line_items[' + index + '][price_data][product_data][name]', value: name });
  if (description) lineItems.push({ key: 'line_items[' + index + '][price_data][product_data][description]', value: description });
}

function parseCart_(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function setStripeSecretKey() {
  const secretKey = Browser.inputBox('Stripe秘密鍵を貼り付けてください。sk_live_ または sk_test_ から始まるキーです。');
  if (!/^sk_(live|test)_/.test(secretKey)) throw new Error('Stripe秘密鍵の形式が正しくありません。');
  PropertiesService.getScriptProperties().setProperty('STRIPE_SECRET_KEY', secretKey);
  SpreadsheetApp.getActiveSpreadsheet().toast('Stripe秘密鍵を非公開設定に保存しました。');
}

function authorizeStripeConnection() {
  const secretKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('Stripe秘密鍵が未設定です。');
  const response = UrlFetchApp.fetch('https://api.stripe.com/v1/account', {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + secretKey,
      'Stripe-Version': '2026-02-25.clover'
    },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Stripe接続確認に失敗しました: ' + response.getContentText());
  SpreadsheetApp.getActiveSpreadsheet().toast('Stripe接続を確認しました。');
}

function safeReturnUrl_(value) {
  const fallback = 'https://example.com/';
  const url = String(value || '').trim();
  return /^https:\/\/[^\s]+$/i.test(url) ? url : fallback;
}

function writeUnifiedSheet_(products, categories) {
  const productRows = products.map(function(product) {
    return [
      product.id || '',
      product.name || '',
      Number(product.price || 0),
      Number(product.stock || 0),
      formatVariants_(product.variants),
      product.visible === false ? '非表示' : '表示',
      (product.categories || []).join(', '),
      product.label || '',
      product.description || '',
      product.image || (product.images && product.images[0]) || '',
      formatOptions_(product.options),
      new Date().toISOString()
    ];
  });

  const categoryRows = categories.map(function(category) { return [category.key, category.label]; });
  writeTable_(UNIFIED_SHEET, unifiedHeaders_(), productRows);
  writeTable_(CATEGORY_SHEET, categoryHeaders_(), categoryRows);
}

function readProductsFromSheets_() {
  const baseline = readHiddenData_();
  const baselineById = {};
  baseline.products.forEach(function(product) { baselineById[String(product.id || '')] = product; });

  const rows = readRows_(UNIFIED_SHEET, unifiedHeaders_().length);

  const products = rows.filter(function(row) { return String(row[0] || row[1] || '').trim(); }).map(function(row, index) {
    const id = String(row[0] || ('sheet-item-' + (index + 2))).trim();
    const base = baselineById[id] || {};
    const sheetImage = String(row[9] || '').trim();
    const baselineImage = String(base.image || (Array.isArray(base.images) ? base.images[0] : '') || '').trim();
    const image = normalizeImageUrl_(isUsableImageValue_(sheetImage) ? sheetImage : (baselineImage || './assets/hero-handmade.png'));
    const variants = parseVariants_(row[4]);
    const options = parseOptions_(row[10]);
    const sheetStock = Math.max(0, Number(row[3] || 0));
    const stock = variants.length ? variants.reduce(function(sum, variant) { return sum + Number(variant.stock || 0); }, 0) : sheetStock;
    const categories = splitList_(row[6]);

    return {
      id: id,
      name: String(row[1] || base.name || '名称未設定'),
      price: Math.max(0, Number(row[2] || 0)),
      stock: stock,
      description: String(row[8] == null ? (base.description || '') : row[8]),
      image: image,
      images: Array.isArray(base.images) && base.images.length ? replaceFirstImage_(base.images.map(normalizeImageUrl_), image) : [image],
      stripeUrl: String(base.stripeUrl || ''),
      label: String(row[7] == null ? (base.label || '') : row[7]),
      visible: parseVisible_(row[5]),
      categories: categories.length ? categories : (base.categories || ['new']),
      variants: variants,
      options: options
    };
  });

  const categories = readRows_(CATEGORY_SHEET, 2)
    .filter(function(row) { return String(row[0] || '').startsWith('custom-') && String(row[1] || '').trim(); })
    .map(function(row) { return { key: String(row[0]), label: String(row[1]).trim() }; });

  return { products: products, categories: categories };
}

function migrateLegacySheets_() {
  const baseline = readHiddenData_();
  const baselineById = {};
  baseline.products.forEach(function(product) { baselineById[String(product.id || '')] = product; });
  const variantsById = groupVariants_();
  const optionsById = groupOptions_();
  const rows = readRows_(PRODUCT_SHEET, productHeaders_().length);
  const migrated = rows.filter(function(row) { return String(row[0] || row[1] || '').trim(); }).map(function(row, index) {
    const id = String(row[0] || ('sheet-item-' + (index + 2))).trim();
    const base = baselineById[id] || {};
    return {
      id: id,
      name: String(row[1] || base.name || '名称未設定'),
      price: Math.max(0, Number(row[2] || 0)),
      stock: Math.max(0, Number(row[3] || 0)),
      visible: parseVisible_(row[4]),
      categories: splitList_(row[5]),
      label: String(row[6] || base.label || ''),
      stripeUrl: String(row[7] || base.stripeUrl || ''),
      description: String(row[8] || base.description || ''),
      image: String(row[9] || base.image || ''),
      images: Array.isArray(base.images) ? base.images : [],
      variants: variantsById[id] || base.variants || [],
      options: optionsById[id] || base.options || []
    };
  });
  const products = migrated.length ? migrated : baseline.products;
  if (products.length) writeUnifiedSheet_(products, baseline.categories || []);
}

function hideLegacySheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  [PRODUCT_SHEET, VARIANT_SHEET, OPTION_SHEET].forEach(function(name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet && !sheet.isSheetHidden()) sheet.hideSheet();
  });
}

function groupVariants_() {
  const grouped = {};
  readRows_(VARIANT_SHEET, variantHeaders_().length).forEach(function(row) {
    const id = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    if (!id || !name) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push({
      name: name,
      stock: Math.max(0, Number(row[2] || 0)),
      stripeUrl: String(row[3] || ''),
      image: String(row[4] || '')
    });
  });
  return grouped;
}

function groupOptions_() {
  const grouped = {};
  readRows_(OPTION_SHEET, optionHeaders_().length).forEach(function(row) {
    const id = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    if (!id || !name) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push({ name: name, priceAdjustment: Math.max(0, Number(row[2] || 0)) });
  });
  return grouped;
}

function writeHiddenData_(data) {
  const sheet = ensureSheet_(DATA_SHEET, ['JSON']);
  const json = JSON.stringify(data);
  const chunks = [];
  for (let index = 0; index < json.length; index += JSON_CHUNK_SIZE) chunks.push([json.slice(index, index + JSON_CHUNK_SIZE)]);
  sheet.clearContents();
  if (chunks.length) sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  if (!sheet.isSheetHidden()) sheet.hideSheet();
}

function readHiddenData_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return { products: [], categories: [] };
  const json = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function(row) { return String(row[0] || ''); }).join('');
  if (!json || json === 'JSON') return { products: [], categories: [] };
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { products: [], categories: [] };
  }
  if (Array.isArray(parsed)) return { products: parsed, categories: [] };
  return {
    products: Array.isArray(parsed.products) ? parsed.products : [],
    categories: normalizeCategories_(parsed.categories)
  };
}

function writeSettings_(token) {
  writeTable_(SETTINGS_SHEET, ['項目', '値'], [
    ['管理用同期キー', token],
    ['説明', 'このキーはHP管理画面から商品を書き込むために使用します。公開しないでください。']
  ]);
}

function getWriteToken_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const tokenRow = rows.find(function(row) { return String(row[0]) === '管理用同期キー'; });
  return tokenRow ? String(tokenRow[1] || '') : '';
}

function writeTable_(name, headers, rows) {
  const sheet = ensureSheet_(name, headers);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0e7dc');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function ensureSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (headers && sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function readRows_(name, columnCount) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, columnCount).getValues();
}

function productHeaders_() {
  return ['商品ID', '商品名', '基本価格', '合計在庫', 'HP表示', '掲載カテゴリキー', '表示ラベル', 'Stripeリンク', '説明', 'メイン画像URL', '更新日時'];
}
function variantHeaders_() { return ['商品ID', 'カラー名', '在庫数', 'Stripeリンク', '画像URL']; }
function optionHeaders_() { return ['商品ID', 'オプション名', '追加料金']; }
function unifiedHeaders_() {
  return ['商品ID', '商品名', '基本価格', '在庫数', 'カラー別在庫', 'HP表示', '掲載カテゴリキー', '表示ラベル', '説明', '画像URL', '追加オプション', '更新日時'];
}
function categoryHeaders_() { return ['タブキー', 'タブ名']; }

function formatVariants_(variants) {
  return (Array.isArray(variants) ? variants : []).map(function(variant) {
    return String(variant.name || '') + ':' + Math.max(0, Number(variant.stock || 0));
  }).filter(function(value) { return value.charAt(0) !== ':'; }).join('\n');
}

function formatOptions_(options) {
  return (Array.isArray(options) ? options : []).map(function(option) {
    return String(option.name || '') + ':+' + Math.max(0, Number(option.priceAdjustment || 0));
  }).filter(function(value) { return value.indexOf(':+') !== 0; }).join('\n');
}

function splitEntries_(value) {
  return String(value || '').split(/\r?\n|\s*\/\s*|、|,/).map(function(entry) { return entry.trim(); }).filter(Boolean);
}

function parseVariants_(value) {
  return splitEntries_(value).map(function(entry) {
    const match = entry.match(/^(.+?)\s*[:：]\s*(\d+)$/);
    return match ? { name: match[1].trim(), stock: Math.max(0, Number(match[2])) } : null;
  }).filter(Boolean);
}

function parseOptions_(value) {
  return splitEntries_(value).map(function(entry) {
    const match = entry.match(/^(.+?)\s*[:：]\s*\+?(\d+)$/);
    return match ? { name: match[1].trim(), priceAdjustment: Math.max(0, Number(match[2])) } : null;
  }).filter(Boolean);
}

function normalizeCategories_(categories) {
  return Array.isArray(categories) ? categories.filter(function(category) {
    return category && String(category.key || '').startsWith('custom-') && String(category.label || '').trim();
  }).map(function(category) { return { key: String(category.key), label: String(category.label).trim() }; }) : [];
}

function splitList_(value) {
  return String(value || '').split(/[,、]/).map(function(item) { return item.trim(); }).filter(Boolean);
}

function parseVisible_(value) {
  const normalized = String(value == null ? '表示' : value).trim().toLowerCase();
  return !['非表示', 'false', '0', 'off'].includes(normalized);
}

function replaceFirstImage_(images, firstImage) {
  const copy = images.slice();
  if (copy.length) copy[0] = firstImage;
  else copy.push(firstImage);
  return copy;
}

function saveUploadedImages_(products) {
  const folder = getImageFolder_();
  return products.map(function(product) {
    const copy = JSON.parse(JSON.stringify(product));
    const images = Array.isArray(copy.images) && copy.images.length ? copy.images : [copy.image].filter(Boolean);
    const imageMap = {};
    const publishedImages = images.map(function(image, index) {
      const published = publishImage_(folder, image, String(copy.id || 'item') + '-' + (index + 1));
      imageMap[image] = published;
      return normalizeImageUrl_(published);
    });
    copy.images = publishedImages;
    copy.image = publishedImages[0] || copy.image || '';
    copy.variants = (Array.isArray(copy.variants) ? copy.variants : []).map(function(variant) {
      const variantCopy = Object.assign({}, variant);
      if (variantCopy.image && imageMap[variantCopy.image]) variantCopy.image = imageMap[variantCopy.image];
      else variantCopy.image = normalizeImageUrl_(variantCopy.image);
      return variantCopy;
    });
    return copy;
  });
}

function publishImage_(folder, image, baseName) {
  const value = String(image || '');
  const match = value.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) return normalizeImageUrl_(value);
  const mimeType = match[1];
  const extension = mimeType.indexOf('png') >= 0 ? 'png' : mimeType.indexOf('webp') >= 0 ? 'webp' : 'jpg';
  const fileName = baseName.replace(/[^0-9A-Za-z_-]/g, '_') + '.' + extension;
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return driveImageUrl_(file.getId());
}

function normalizeImageUrl_(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  const ucMatch = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const fileMatch = url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  const thumbnailMatch = url.match(/drive\.google\.com\/thumbnail\?id=([A-Za-z0-9_-]+)/);
  const id = (thumbnailMatch || ucMatch || fileMatch || [])[1];
  return id ? driveImageUrl_(id) : url;
}

function isUsableImageValue_(value) {
  const image = String(value || '').trim();
  return /^(https?:\/\/|data:image\/|\.\.?\/|\/)/i.test(image);
}

function driveImageUrl_(id) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w900';
}

function getImageFolder_() {
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
