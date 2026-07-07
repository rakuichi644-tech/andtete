const SHEET_NAME = '商品在庫';
const DATA_SHEET_NAME = 'HP商品データ';
const IMAGE_FOLDER_NAME = 'andtete商品画像';
const SHARE_EMAIL = 'and.tete03@gmail.com';
const JSON_CHUNK_SIZE = 45000;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const products = Array.isArray(payload.products) ? payload.products : [];
    const publishedProducts = saveUploadedImages_(products);

    writeInventorySheet_(publishedProducts);
    writeProductData_(publishedProducts);

    return jsonOutput_({ ok: true, count: publishedProducts.length, updatedAt: new Date().toISOString() });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const products = readProductData_();
  const payload = JSON.stringify({
    ok: true,
    products: products,
    updatedAt: new Date().toISOString()
  });
  const callback = e && e.parameter ? String(e.parameter.callback || '') : '';

  if (/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function writeInventorySheet_(products) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const headers = [
    '商品ID',
    '商品名',
    '価格',
    '在庫数',
    'ステータス',
    '掲載カテゴリ',
    'HP表示',
    'Stripeリンク',
    '説明',
    '写真枚数',
    'カラーバリエーション',
    '追加オプション',
    '更新日時'
  ];

  const rows = products.map(function(product) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const options = Array.isArray(product.options) ? product.options : [];
    const categories = Array.isArray(product.categories) ? product.categories.join(', ') : String(product.categories || '');
    const imageCount = Array.isArray(product.images) ? product.images.length : product.image ? 1 : 0;
    const stock = Number(product.stock || 0);

    return [
      product.id || '',
      product.name || '',
      Number(product.price || 0),
      stock,
      product.visible === false ? '非表示' : stock > 0 ? '販売中' : '在庫なし',
      categories,
      product.visible === false ? '非表示' : '表示',
      product.stripeUrl || '',
      product.description || '',
      imageCount,
      variants.map(function(variant) { return (variant.name || '') + ':' + Number(variant.stock || 0) + '点'; }).join(' / '),
      options.map(function(option) { return (option.name || '') + '：+' + Number(option.priceAdjustment || 0) + '円'; }).join(' / '),
      new Date().toISOString()
    ];
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0e7dc');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function writeProductData_(products) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(DATA_SHEET_NAME) || spreadsheet.insertSheet(DATA_SHEET_NAME);
  const json = JSON.stringify(products);
  const chunks = [];

  for (let index = 0; index < json.length; index += JSON_CHUNK_SIZE) {
    chunks.push([json.slice(index, index + JSON_CHUNK_SIZE)]);
  }

  sheet.clearContents();
  if (chunks.length) sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  sheet.hideSheet();
}

function readProductData_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(DATA_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 1) return [];

  const json = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues()
    .map(function(row) { return String(row[0] || ''); })
    .join('');

  if (!json) return [];
  return JSON.parse(json);
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
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupShare() {
  const file = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  file.addEditor(SHARE_EMAIL);
}
