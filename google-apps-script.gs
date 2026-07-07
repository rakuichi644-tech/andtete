const PRODUCT_SHEET = '商品一覧';
const VARIANT_SHEET = 'カラー在庫';
const OPTION_SHEET = '追加オプション';
const CATEGORY_SHEET = '商品タブ';
const SETTINGS_SHEET = '設定';
const DATA_SHEET = 'HP商品データ';
const IMAGE_FOLDER_NAME = 'andtete商品画像';
const JSON_CHUNK_SIZE = 45000;

function setupProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const token = getWriteToken_() || Utilities.getUuid().replace(/-/g, '');

  writeSettings_(token);
  ensureSheet_(PRODUCT_SHEET, productHeaders_());
  ensureSheet_(VARIANT_SHEET, variantHeaders_());
  ensureSheet_(OPTION_SHEET, optionHeaders_());
  ensureSheet_(CATEGORY_SHEET, categoryHeaders_());
  ensureSheet_(DATA_SHEET, ['JSON']);

  const dataSheet = spreadsheet.getSheetByName(DATA_SHEET);
  if (dataSheet && !dataSheet.isSheetHidden()) dataSheet.hideSheet();

  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(PRODUCT_SHEET));
  return token;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expectedToken = getWriteToken_();
    if (!expectedToken || String(payload.token || '') !== expectedToken) {
      return jsonOutput_({ ok: false, error: '管理用同期キーが正しくありません。' });
    }

    const products = Array.isArray(payload.products) ? payload.products : [];
    const categories = normalizeCategories_(payload.categories);
    const publishedProducts = saveUploadedImages_(products);

    writeProductSheets_(publishedProducts, categories);
    writeHiddenData_({ products: publishedProducts, categories: categories });

    return jsonOutput_({ ok: true, count: publishedProducts.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
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

function writeProductSheets_(products, categories) {
  const productRows = products.map(function(product) {
    return [
      product.id || '',
      product.name || '',
      Number(product.price || 0),
      Number(product.stock || 0),
      product.visible === false ? '非表示' : '表示',
      (product.categories || []).join(', '),
      product.label || '',
      product.stripeUrl || '',
      product.description || '',
      product.image || (product.images && product.images[0]) || '',
      new Date().toISOString()
    ];
  });

  const variantRows = [];
  products.forEach(function(product) {
    (Array.isArray(product.variants) ? product.variants : []).forEach(function(variant) {
      variantRows.push([
        product.id || '',
        variant.name || '',
        Number(variant.stock || 0),
        variant.stripeUrl || '',
        variant.image || ''
      ]);
    });
  });

  const optionRows = [];
  products.forEach(function(product) {
    (Array.isArray(product.options) ? product.options : []).forEach(function(option) {
      optionRows.push([
        product.id || '',
        option.name || '',
        Number(option.priceAdjustment || 0)
      ]);
    });
  });

  const categoryRows = categories.map(function(category) { return [category.key, category.label]; });
  writeTable_(PRODUCT_SHEET, productHeaders_(), productRows);
  writeTable_(VARIANT_SHEET, variantHeaders_(), variantRows);
  writeTable_(OPTION_SHEET, optionHeaders_(), optionRows);
  writeTable_(CATEGORY_SHEET, categoryHeaders_(), categoryRows);
}

function readProductsFromSheets_() {
  const baseline = readHiddenData_();
  const baselineById = {};
  baseline.products.forEach(function(product) { baselineById[String(product.id || '')] = product; });

  const variantsById = groupVariants_();
  const optionsById = groupOptions_();
  const rows = readRows_(PRODUCT_SHEET, productHeaders_().length);

  const products = rows.filter(function(row) { return String(row[0] || row[1] || '').trim(); }).map(function(row, index) {
    const id = String(row[0] || ('sheet-item-' + (index + 2))).trim();
    const base = baselineById[id] || {};
    const image = String(row[9] || base.image || './assets/hero-handmade.png').trim();
    const variants = Object.prototype.hasOwnProperty.call(variantsById, id) ? variantsById[id] : (base.variants || []);
    const options = Object.prototype.hasOwnProperty.call(optionsById, id) ? optionsById[id] : (base.options || []);
    const sheetStock = Math.max(0, Number(row[3] || 0));
    const stock = variants.length ? variants.reduce(function(sum, variant) { return sum + Number(variant.stock || 0); }, 0) : sheetStock;
    const categories = splitList_(row[5]);

    return {
      id: id,
      name: String(row[1] || base.name || '名称未設定'),
      price: Math.max(0, Number(row[2] || 0)),
      stock: stock,
      description: String(row[8] || base.description || ''),
      image: image,
      images: Array.isArray(base.images) && base.images.length ? replaceFirstImage_(base.images, image) : [image],
      stripeUrl: String(row[7] || base.stripeUrl || ''),
      label: String(row[6] || base.label || ''),
      visible: parseVisible_(row[4]),
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
  if (!json) return { products: [], categories: [] };
  const parsed = JSON.parse(json);
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
function categoryHeaders_() { return ['タブキー', 'タブ名']; }

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
      return published;
    });
    copy.images = publishedImages;
    copy.image = publishedImages[0] || copy.image || '';
    copy.variants = (Array.isArray(copy.variants) ? copy.variants : []).map(function(variant) {
      const variantCopy = Object.assign({}, variant);
      if (variantCopy.image && imageMap[variantCopy.image]) variantCopy.image = imageMap[variantCopy.image];
      return variantCopy;
    });
    return copy;
  });
}

function publishImage_(folder, image, baseName) {
  const value = String(image || '');
  const match = value.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) return value;
  const mimeType = match[1];
  const extension = mimeType.indexOf('png') >= 0 ? 'png' : mimeType.indexOf('webp') >= 0 ? 'webp' : 'jpg';
  const fileName = baseName.replace(/[^0-9A-Za-z_-]/g, '_') + '.' + extension;
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

function getImageFolder_() {
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
