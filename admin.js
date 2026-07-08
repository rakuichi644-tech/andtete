const categoryNames = {
  new: "NEW ARRIVALS",
  recommend: "おすすめ",
  preorder: "予約商品",
  stock: "即納商品",
};

const imageNames = {
  "./assets/item-green-bag.png": "かごバッグ グリーン",
  "./assets/item-natural-bag.png": "かごバッグ ナチュラル",
  "./assets/item-candles.png": "キャンドル",
  "./assets/item-cups.png": "マグカップ",
  "./assets/item-flowers.png": "花のトレイ",
  "./assets/item-linen.png": "リネンクロス",
  "./assets/item-plate.png": "小皿",
};

const storageKey = "andteteProductsPreview";
const sheetUrlKey = "andteteSheetWebhookUrl";
const sheetTokenKey = "andteteSheetSyncToken";
const customCategoryStorageKey = "andteteCustomCategories";
const defaultImage = "./assets/item-green-bag.png";
const form = document.querySelector("#productForm");
const productList = document.querySelector("#productList");
const adminStatus = document.querySelector("#adminStatus");
const jsonOutput = document.querySelector("#jsonOutput");
const sheetWebhookUrl = document.querySelector("#sheetWebhookUrl");
const sheetSyncToken = document.querySelector("#sheetSyncToken");
const imageInput = document.querySelector("#image");
const imagePreview = document.querySelector("#imagePreview");
const imageUpload = document.querySelector("#imageUpload");
const imagePreset = document.querySelector("#imagePreset");
const imageThumbs = document.querySelector("#imageThumbs");
const variantList = document.querySelector("#variantList");
const optionList = document.querySelector("#optionList");
const categoryChecks = document.querySelector("#categoryChecks");
const customCategoryList = document.querySelector("#customCategoryList");
const adminFilterTabs = document.querySelector("#adminFilterTabs");
const adminPagination = document.querySelector("#adminPagination");
const adminProductCount = document.querySelector("#adminProductCount");
const maxImages = 7;
const adminPageSize = 10;

let products = [];
let editingId = "";
let currentImages = [defaultImage];
let currentVariants = [];
let currentOptions = [];
let customCategories = [];
let activeAdminFilter = "all";
let activeAdminPage = 1;
let imageDragIndex = null;
let imagePointerDrag = null;
let suppressImageClick = false;

function uid() {
  return `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function yen(price) {
  return `${Number(price || 0).toLocaleString("ja-JP")}円`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function message(text) {
  adminStatus.textContent = text;
}

function loadLocalText(key) {
  try {
    const value = localStorage.getItem(key);
    if (value) return value;
  } catch (error) {}
  try {
    const value = sessionStorage.getItem(key);
    if (value) return value;
  } catch (error) {}
  const cookie = document.cookie.split("; ").find((row) => row.startsWith(`${key}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
}

function saveLocalText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {}
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/andtete; max-age=2592000; SameSite=Lax`;
}

function savePreview() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(products));
  } catch (error) {
    message("保存容量がいっぱいです。写真を少なめにするか、公開用ファイルを作って制作担当者に渡してください。");
  }
}

function normalizeCustomCategories(categories) {
  return Array.isArray(categories)
    ? categories
        .filter((category) => category && String(category.key || "").startsWith("custom-") && String(category.label || "").trim())
        .map((category) => ({ key: String(category.key), label: String(category.label).trim() }))
    : [];
}

function updateCategoryNames() {
  Object.keys(categoryNames).forEach((key) => {
    if (key.startsWith("custom-")) delete categoryNames[key];
  });
  customCategories.forEach((category) => {
    categoryNames[category.key] = category.label;
  });
}

function saveCustomCategories() {
  localStorage.setItem(customCategoryStorageKey, JSON.stringify(customCategories));
  updateCategoryNames();
}

function renderCategoryChecks(selectedCategories = getCategories()) {
  categoryChecks.innerHTML = Object.entries(categoryNames)
    .map(([key, label]) => `<label><input type="checkbox" name="category" value="${escapeHtml(key)}" ${selectedCategories.includes(key) ? "checked" : ""} /> ${escapeHtml(label)}</label>`)
    .join("");
}

function renderCustomCategoryList() {
  customCategoryList.innerHTML = customCategories.length
    ? customCategories.map((category) => `<span class="custom-category-chip">${escapeHtml(category.label)}<button type="button" data-delete-category="${escapeHtml(category.key)}" aria-label="${escapeHtml(category.label)}を削除">×</button></span>`).join("")
    : `<span class="empty-message">追加したタブはありません。</span>`;
}

function renderAdminFilterTabs() {
  const tabs = [["all", "すべて"], ...Object.entries(categoryNames)];
  adminFilterTabs.innerHTML = tabs
    .map(([key, label]) => `<button class="${activeAdminFilter === key ? "active" : ""}" type="button" data-admin-filter="${escapeHtml(key)}" aria-selected="${activeAdminFilter === key}">${escapeHtml(label)}</button>`)
    .join("");
}

function getCategories() {
  return [...form.querySelectorAll("[name='category']:checked")].map((input) => input.value);
}

function setCategories(categories) {
  form.querySelectorAll("[name='category']").forEach((input) => {
    input.checked = categories.includes(input.value);
  });
}

function clearForm() {
  editingId = "";
  form.reset();
  setImages([defaultImage]);
  setVariants([]);
  setOptions([]);
  document.querySelector("#stock").value = 1;
  document.querySelector("#visible").checked = true;
  renderCategoryChecks([]);
  setCategories(["new"]);
  document.querySelector("#saveProduct").textContent = "この商品を保存";
}

function normalizeVariants(product) {
  return Array.isArray(product?.variants)
    ? product.variants
        .filter((variant) => variant && String(variant.name || "").trim())
        .map((variant) => ({
          name: String(variant.name || "").trim(),
          stock: Math.max(0, Number(variant.stock ?? 0)),
          imageIndex: Math.max(0, Number(variant.imageIndex ?? 0)),
          image: String(variant.image || "").trim(),
        }))
    : [];
}

function setVariants(variants) {
  currentVariants = normalizeVariants({ variants });
  renderVariants();
}

function collectVariants() {
  return [...variantList.querySelectorAll("[data-variant-row]")]
    .map((row) => {
      const imageIndex = Number(row.querySelector("[data-variant-field='imageIndex']").value || 0);
      return {
        name: row.querySelector("[data-variant-field='name']").value.trim(),
        stock: Math.max(0, Number(row.querySelector("[data-variant-field='stock']").value || 0)),
        imageIndex,
        image: currentImages[imageIndex] || currentImages[0] || defaultImage,
      };
    })
    .filter((variant) => variant.name);
}

function renderVariants() {
  variantList.innerHTML = currentVariants
    .map((variant, index) => `
      <div class="variant-row" data-variant-row="${index}">
        <label>カラー名
          <input data-variant-field="name" value="${escapeHtml(variant.name)}" placeholder="例: アイボリー" />
        </label>
        <label>在庫数
          <input data-variant-field="stock" type="number" min="0" inputmode="numeric" value="${Number(variant.stock ?? 0)}" />
        </label>
        <label>カラー写真
          <select data-variant-field="imageIndex">
            ${currentImages.map((_, imageIndex) => `<option value="${imageIndex}" ${imageIndex === Number(variant.imageIndex ?? 0) ? "selected" : ""}>写真${imageIndex + 1}</option>`).join("")}
          </select>
        </label>
        <button class="variant-remove" type="button" data-remove-variant="${index}">この色を削除</button>
      </div>
    `)
    .join("");
}

function normalizeOptions(product) {
  return Array.isArray(product?.options)
    ? product.options
        .filter((option) => option && String(option.name || "").trim())
        .map((option) => ({
          name: String(option.name || "").trim(),
          priceAdjustment: Math.max(0, Number(option.priceAdjustment || 0)),
        }))
    : [];
}

function setOptions(options) {
  currentOptions = normalizeOptions({ options });
  renderOptions();
}

function collectOptions() {
  return [...optionList.querySelectorAll("[data-option-row]")]
    .map((row) => ({
      name: row.querySelector("[data-option-field='name']").value.trim(),
      priceAdjustment: Math.max(0, Number(row.querySelector("[data-option-field='priceAdjustment']").value || 0)),
    }))
    .filter((option) => option.name);
}

function renderOptions() {
  optionList.innerHTML = currentOptions
    .map((option, index) => `
      <div class="option-row" data-option-row="${index}">
        <label>オプション名
          <input data-option-field="name" value="${escapeHtml(option.name)}" placeholder="例: 耳をつける" />
        </label>
        <label>追加料金
          <input data-option-field="priceAdjustment" type="number" min="0" inputmode="numeric" value="${Number(option.priceAdjustment || 0)}" />
        </label>
        <button class="variant-remove" type="button" data-remove-option="${index}">削除</button>
      </div>
    `)
    .join("");
}

function normalizeImages(product) {
  const images = Array.isArray(product?.images) && product.images.length ? product.images : [product?.image || defaultImage];
  return images.filter(Boolean).slice(0, maxImages);
}

function setImages(values) {
  currentImages = (values?.length ? values : [defaultImage]).filter(Boolean).slice(0, maxImages);
  imageInput.value = currentImages[0] || defaultImage;
  imagePreview.src = currentImages[0] || defaultImage;
  imagePreset.value = currentImages.length === 1 && imageNames[currentImages[0]] ? currentImages[0] : "";
  renderImageThumbs();
  if (variantList) renderVariants();
}

function renderImageThumbs() {
  imageThumbs.innerHTML = currentImages
    .map(
      (image, index) => `
        <div class="image-thumb-wrap" data-image-drag="${index}">
          <button class="image-thumb ${index === 0 ? "active" : ""}" type="button" data-image-index="${index}" aria-label="写真${index + 1}をメインにする">
            <img src="${image}" alt="登録写真${index + 1}" />
            <span>${index + 1}</span>
          </button>
        </div>
      `
    )
    .join("");
}

function reorderImages(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= currentImages.length || toIndex >= currentImages.length) return;
  const reordered = currentImages.slice();
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  setImages(reordered);
  message("写真の順番を変更しました。1枚目がメイン写真です。");
}

function readForm() {
  const name = document.querySelector("#name").value.trim();
  const categories = getCategories();

  if (!name) {
    message("商品名を入力してください。");
    return null;
  }

  if (!categories.length) {
    message("掲載場所を1つ以上選んでください。");
    return null;
  }

  const variants = collectVariants();
  const options = collectOptions();
  const totalStock = variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : Number(document.querySelector("#stock").value || 0);

  return {
    id: editingId || uid(),
    name,
    price: Number(document.querySelector("#price").value || 0),
    stock: totalStock,
    description: document.querySelector("#description").value.trim(),
    image: currentImages[0] || defaultImage,
    images: currentImages,
    stripeUrl: "",
    label: document.querySelector("#label").value.trim(),
    visible: document.querySelector("#visible").checked,
    categories,
    variants,
    options,
  };
}

function fillForm(product) {
  editingId = product.id;
  document.querySelector("#name").value = product.name || "";
  document.querySelector("#price").value = product.price || 0;
  document.querySelector("#stock").value = product.stock ?? 0;
  document.querySelector("#description").value = product.description || "";
  setImages(normalizeImages(product));
  setVariants(normalizeVariants(product).map((variant) => ({
    ...variant,
    imageIndex: Math.max(0, currentImages.indexOf(variant.image)),
  })));
  setOptions(normalizeOptions(product));
  document.querySelector("#label").value = product.label || "";
  document.querySelector("#visible").checked = product.visible !== false;
  setCategories(product.categories || ["new"]);
  document.querySelector("#saveProduct").textContent = "変更を保存";
  window.scrollTo({ top: 0, behavior: "smooth" });
  message("編集したい内容を直して「変更を保存」を押してください。");
}

function renderList() {
  const filteredProducts = activeAdminFilter === "all"
    ? products
    : products.filter((product) => product.categories?.includes(activeAdminFilter));
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / adminPageSize));
  activeAdminPage = Math.min(activeAdminPage, totalPages);
  const pageStart = (activeAdminPage - 1) * adminPageSize;
  const pageProducts = filteredProducts.slice(pageStart, pageStart + adminPageSize);

  renderAdminFilterTabs();
  adminProductCount.textContent = `${filteredProducts.length}商品・${activeAdminPage}/${totalPages}ページ`;

  productList.innerHTML = pageProducts
    .map((product) => {
      const places = (product.categories || []).map((category) => categoryNames[category] || category).join(" / ");
      const status = product.visible === false ? "非表示" : "表示中";
      const images = normalizeImages(product);
      return `
        <article class="easy-product-card">
          <img src="${images[0]}" alt="${product.name}" />
          <div>
            <div class="easy-product-title">
              <h3>${product.name || "名称未設定"}</h3>
              <span>${yen(product.price)}</span>
            </div>
            <p>${product.description || "説明文なし"}</p>
            <small>${status} / 在庫${Number(product.stock ?? 0).toLocaleString("ja-JP")}点 / ${places || "掲載場所なし"} / 写真${images.length}枚${normalizeVariants(product).length ? ` / カラー${normalizeVariants(product).length}種` : ""}${normalizeOptions(product).length ? ` / オプション${normalizeOptions(product).length}個` : ""}</small>
            <div class="easy-card-actions">
              <button type="button" data-edit="${product.id}">編集</button>
              <button type="button" data-toggle="${product.id}">${product.visible === false ? "表示する" : "非表示にする"}</button>
              <button type="button" data-delete="${product.id}">削除</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("") || `<p class="empty-message">このタブに登録中の商品はありません。</p>`;

  adminPagination.innerHTML = totalPages > 1
    ? `${activeAdminPage > 1 ? `<button type="button" data-admin-page="${activeAdminPage - 1}">前へ</button>` : ""}
      ${Array.from({ length: totalPages }, (_, index) => index + 1)
        .map((page) => `<button class="${page === activeAdminPage ? "active" : ""}" type="button" data-admin-page="${page}" aria-current="${page === activeAdminPage ? "page" : "false"}">${page}</button>`)
        .join("")}
      ${activeAdminPage < totalPages ? `<button type="button" data-admin-page="${activeAdminPage + 1}">次へ</button>` : ""}`
    : "";
}

function normalizeProduct(product) {
  const images = normalizeImages(product);
  const variants = normalizeVariants(product);
  const options = normalizeOptions(product);
  return {
    ...product,
    image: images[0],
    images,
    stock: variants.length ? variants.reduce((sum, variant) => sum + variant.stock, 0) : Number(product.stock ?? 1),
    variants,
    options,
  };
}

function adminSheetDataUrl() {
  return String(sheetWebhookUrl.value || window.ANDTETE_CONFIG?.sheetWebAppUrl || loadLocalText(sheetUrlKey) || "").trim();
}

function loadRemoteProductData(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `andteteAdminCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => finish(new Error("商品データの取得がタイムアウトしました。")), 30000);

    function finish(error, data) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else resolve(data);
    }

    window[callbackName] = (payload) => {
      const remoteProducts = Array.isArray(payload) ? payload : payload?.products;
      if (!Array.isArray(remoteProducts)) {
        finish(new Error("商品データの形式が正しくありません。"));
        return;
      }
      finish(null, {
        products: remoteProducts,
        categories: Array.isArray(payload?.categories) ? payload.categories : [],
      });
    };
    script.onerror = () => finish(new Error("スプレッドシートの商品を取得できませんでした。"));
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function applyRemoteProductData(data) {
  products = data.products.map(normalizeProduct);
  customCategories = normalizeCustomCategories(data.categories);
  saveCustomCategories();
  renderCategoryChecks([]);
  renderCustomCategoryList();
  savePreview();
  renderList();
}

async function refreshProductsFromSheet(showMessage = false) {
  const url = adminSheetDataUrl();
  if (!url.startsWith("https://script.google.com/")) return false;
  try {
    const data = await loadRemoteProductData(url);
    applyRemoteProductData(data);
    if (showMessage) message("スプレッドシートの最新商品・在庫を読み込みました。");
    return true;
  } catch (error) {
    if (showMessage) message("スプレッドシートの読み込みに失敗しました。少し待って再度お試しください。");
    return false;
  }
}

async function loadProducts() {
  const saved = localStorage.getItem(storageKey);
  const remoteUrl = adminSheetDataUrl();
  if (remoteUrl.startsWith("https://script.google.com/")) {
    try {
      const data = await loadRemoteProductData(remoteUrl);
      if (data.products.length || !saved) {
        applyRemoteProductData(data);
        return;
      }
    } catch (error) {
      console.warn("スプレッドシートの商品取得に失敗したため、ブラウザ内の商品を表示します。", error);
    }
  }
  if (saved) {
    products = JSON.parse(saved).map(normalizeProduct);
    savePreview();
    renderList();
    return;
  }

  try {
    const response = await fetch("./data/products.json", { cache: "no-store" });
    if (!response.ok) throw new Error("商品データを読み込めませんでした。");
    products = (await response.json()).map(normalizeProduct);
  } catch (error) {
    products = Array.isArray(window.ANDTETE_PRODUCTS) ? JSON.parse(JSON.stringify(window.ANDTETE_PRODUCTS)).map(normalizeProduct) : [];
  }
  savePreview();
  renderList();
}

async function resetProducts() {
  localStorage.removeItem(storageKey);
  try {
    const response = await fetch("./data/products.json", { cache: "no-store" });
    if (!response.ok) throw new Error("商品データを読み込めませんでした。");
    products = (await response.json()).map(normalizeProduct);
  } catch (error) {
    products = Array.isArray(window.ANDTETE_PRODUCTS) ? JSON.parse(JSON.stringify(window.ANDTETE_PRODUCTS)).map(normalizeProduct) : [];
  }
  savePreview();
  renderList();
  clearForm();
  await syncAfterChange("初期データに戻しました。");
}

function exportProducts() {
  savePreview();
  const jsonText = `${JSON.stringify(products, null, 2)}\n`;
  jsonOutput.value = jsonText;
  message("公開用ファイルを作りました。ダウンロードされない場合は、下の公開用データを制作担当者に渡してください。");

  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "products.json";
  link.click();
  URL.revokeObjectURL(url);
}

function sheetRows() {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price || 0),
    stock: Number(product.stock || 0),
    status: product.visible === false ? "非表示" : Number(product.stock || 0) > 0 ? "販売中" : "在庫なし",
    categories: (product.categories || []).map((category) => categoryNames[category] || category).join(", "),
    visible: product.visible !== false,
    stripeUrl: product.stripeUrl || "",
    description: product.description || "",
    imageCount: normalizeImages(product).length,
    variants: normalizeVariants(product).map((variant) => `${variant.name}:${variant.stock}点`).join(" / "),
    options: normalizeOptions(product).map((option) => `${option.name}:+${option.priceAdjustment}円`).join(" / "),
    updatedAt: new Date().toISOString(),
  }));
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function remoteHasExpectedProducts(remote, expectedIds) {
  const remoteIds = remote.products.map((product) => String(product.id || ""));
  return expectedIds.every((id) => remoteIds.includes(id));
}

async function waitForSheetReflection(url, expectedIds) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(attempt === 0 ? 2500 : 3500);
    const remote = await loadRemoteProductData(url);
    if (remoteHasExpectedProducts(remote, expectedIds)) return remote;
  }
  return null;
}

function scrollToSheetSettings() {
  document.querySelector("#sheet-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function postSheetWithFetch(url, payload) {
  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

function postSheetWithForm(url, payload) {
  return new Promise((resolve) => {
    const frameName = `andteteSyncFrame_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const iframe = document.createElement("iframe");
    const formElement = document.createElement("form");
    const field = document.createElement("textarea");
    let finished = false;

    function cleanup() {
      if (finished) return;
      finished = true;
      formElement.remove();
      iframe.remove();
      resolve();
    }

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.addEventListener("load", cleanup, { once: true });
    formElement.method = "POST";
    formElement.action = url;
    formElement.target = frameName;
    formElement.hidden = true;
    field.name = "payload";
    field.value = JSON.stringify(payload);
    formElement.appendChild(field);
    document.body.append(iframe, formElement);
    formElement.submit();
    window.setTimeout(cleanup, 15000);
  });
}

async function saveSheetUrl() {
  const url = sheetWebhookUrl.value.trim();
  const token = sheetSyncToken.value.trim();
  saveLocalText(sheetUrlKey, url);
  saveLocalText(sheetTokenKey, token);
  if (!url.startsWith("https://script.google.com/")) {
    message("Google Apps Scriptの連携URLを入力してください。");
    return;
  }
  if (!token) {
    message("設定シートの管理用同期キーを入力してください。");
    return;
  }
  await sendToSheet(false, "連携URLを保存し、現在の商品を同期しました。");
}

async function sendToSheet(silent = false, successText = "スプシとHPへ同期しました。反映まで数秒かかる場合があります。") {
  products = products.map((product) => ({ ...product, stock: Number(product.stock || 0) }));
  savePreview();
  const url = String(sheetWebhookUrl.value || window.ANDTETE_CONFIG?.sheetWebAppUrl || "").trim();
  const token = String(sheetSyncToken.value || loadLocalText(sheetTokenKey) || "").trim();
  const expectedIds = products.map((product) => String(product.id || ""));
  const payload = { token, products, categories: customCategories };

  if (!url.startsWith("https://script.google.com/")) {
    if (!silent) message("ブラウザ内には保存しました。全端末へ自動反映するには、Google Apps Scriptの連携URLを入力してください。");
    return false;
  }
  if (!token) {
    message("このスマホでは管理用同期キーが未設定です。スプシ・HPへ反映するには、下の「管理用同期キー」を一度入力して保存してください。");
    scrollToSheetSettings();
    return false;
  }

  try {
    message("スプシ・HPへ同期中です。スマホ回線では1分ほどかかる場合があります。");
    await postSheetWithFetch(url, payload);
    let remote = await waitForSheetReflection(url, expectedIds);

    if (!remote) {
      await postSheetWithForm(url, payload);
      remote = await waitForSheetReflection(url, expectedIds);
    }

    if (!remote) {
      message("保存はできましたが、スプシ・HPへの反映確認ができません。管理用同期キーとApps Script URLを確認してください。");
      return false;
    }
    applyRemoteProductData(remote);
    message(successText);
    return true;
  } catch (error) {
    message("スプシ・HPへの同期確認に失敗しました。電波状況、Apps Script URL、管理用同期キーを確認してください。");
    return false;
  }
}

async function syncAfterChange(localText) {
  const token = String(sheetSyncToken.value || loadLocalText(sheetTokenKey) || "").trim();
  if (!token) {
    message(`${localText} ただし、このスマホでは管理用同期キーが未設定のため、スプシ・HPにはまだ反映されていません。下の「管理用同期キー」を一度入力してください。`);
    scrollToSheetSettings();
    return;
  }
  const synced = await sendToSheet(true, `${localText} スプシとHPにも自動同期しました。`);
  if (!synced) message(`${localText} このブラウザのHPには自動反映されます。全端末への反映にはApps Script URLの設定が必要です。`);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = url;
  });
}

async function resizeImage(file) {
  const image = await loadImage(file);
  const size = 800;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = Math.floor((image.naturalWidth - cropSize) / 2);
  const sy = Math.floor((image.naturalHeight - cropSize) / 2);

  canvas.width = size;
  canvas.height = size;
  context.fillStyle = "#fbf8f3";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", 0.82);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const product = readForm();
  if (!product) return;

  const index = products.findIndex((item) => item.id === product.id);
  if (index >= 0) {
    products[index] = product;
  } else {
    products.push(product);
  }

  savePreview();
  renderList();
  clearForm();
  await syncAfterChange("商品を保存しました。");
});

document.querySelector("#clearForm").addEventListener("click", () => {
  clearForm();
  message("入力欄を空にしました。");
});

imageUpload.addEventListener("change", async () => {
  const selectedCount = imageUpload.files?.length || 0;
  const files = [...(imageUpload.files || [])].slice(0, maxImages);
  if (!files.length) return;

  if (files.some((file) => !file.type.startsWith("image/"))) {
    message("画像ファイルを選んでください。");
    return;
  }

  message(`${files.length}枚の写真を自動調整しています。少し待ってください。`);
  try {
    const resizedImages = await Promise.all(files.map((file) => resizeImage(file)));
    setImages(resizedImages);
    imageUpload.value = "";
    const limitedText = selectedCount > maxImages ? "8枚目以降は登録されません。" : "";
    message(`${resizedImages.length}枚の写真を登録しました。正方形サイズに自動調整済みです。${limitedText}`);
  } catch (error) {
    message("写真を登録できませんでした。別の画像で試してください。");
  }
});

imagePreset.addEventListener("change", () => {
  if (!imagePreset.value) return;
  setImages([imagePreset.value]);
  message("サンプル写真を設定しました。");
});

imageThumbs.addEventListener("click", (event) => {
  if (suppressImageClick) {
    suppressImageClick = false;
    return;
  }

  const thumb = event.target.closest("[data-image-index]");
  if (!thumb) return;
  const index = Number(thumb.dataset.imageIndex);
  const selected = currentImages[index];
  if (!selected) return;
  currentImages = [selected, ...currentImages.filter((_, imageIndex) => imageIndex !== index)];
  setImages(currentImages);
  message("メイン写真を変更しました。");
});

imageThumbs.addEventListener("dragstart", (event) => {
  const item = event.target.closest("[data-image-drag]");
  if (!item) return;
  imageDragIndex = Number(item.dataset.imageDrag);
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(imageDragIndex));
});

imageThumbs.addEventListener("dragover", (event) => {
  const item = event.target.closest("[data-image-drag]");
  if (!item || imageDragIndex == null) return;
  event.preventDefault();
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.toggle("drag-over", thumb === item));
});

imageThumbs.addEventListener("drop", (event) => {
  const item = event.target.closest("[data-image-drag]");
  event.preventDefault();
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.remove("drag-over", "dragging"));
  if (!item || imageDragIndex == null) return;
  reorderImages(imageDragIndex, Number(item.dataset.imageDrag));
  imageDragIndex = null;
});

imageThumbs.addEventListener("dragend", () => {
  imageDragIndex = null;
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.remove("drag-over", "dragging"));
});

imageThumbs.addEventListener("pointerdown", (event) => {
  const item = event.target.closest("[data-image-drag]");
  if (!item) return;
  imagePointerDrag = {
    from: Number(item.dataset.imageDrag),
    x: event.clientX,
    y: event.clientY,
    active: false,
  };
  item.setPointerCapture?.(event.pointerId);
});

imageThumbs.addEventListener("pointermove", (event) => {
  if (!imagePointerDrag) return;
  const distance = Math.hypot(event.clientX - imagePointerDrag.x, event.clientY - imagePointerDrag.y);
  if (distance > 12) {
    imagePointerDrag.active = true;
    suppressImageClick = true;
  }
  if (!imagePointerDrag.active) return;
  event.preventDefault();
  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-image-drag]");
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.toggle("drag-over", thumb === item));
});

imageThumbs.addEventListener("pointerup", (event) => {
  if (!imagePointerDrag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-image-drag]");
  const from = imagePointerDrag.from;
  const wasActive = imagePointerDrag.active;
  imagePointerDrag = null;
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.remove("drag-over", "dragging"));
  if (wasActive && target) reorderImages(from, Number(target.dataset.imageDrag));
});

imageThumbs.addEventListener("pointercancel", () => {
  imagePointerDrag = null;
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.remove("drag-over", "dragging"));
});

imageThumbs.addEventListener("mousedown", (event) => {
  const item = event.target.closest("[data-image-drag]");
  if (!item || event.button !== 0 || imagePointerDrag) return;
  imagePointerDrag = {
    from: Number(item.dataset.imageDrag),
    x: event.clientX,
    y: event.clientY,
    active: false,
  };
});

window.addEventListener("mousemove", (event) => {
  if (!imagePointerDrag) return;
  const distance = Math.hypot(event.clientX - imagePointerDrag.x, event.clientY - imagePointerDrag.y);
  if (distance > 12) {
    imagePointerDrag.active = true;
    suppressImageClick = true;
  }
  if (!imagePointerDrag.active) return;
  event.preventDefault();
  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-image-drag]");
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.toggle("drag-over", thumb === item));
});

window.addEventListener("mouseup", (event) => {
  if (!imagePointerDrag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-image-drag]");
  const from = imagePointerDrag.from;
  const wasActive = imagePointerDrag.active;
  imagePointerDrag = null;
  imageThumbs.querySelectorAll(".image-thumb-wrap").forEach((thumb) => thumb.classList.remove("drag-over", "dragging"));
  if (wasActive && target) reorderImages(from, Number(target.dataset.imageDrag));
});

document.querySelector("#addVariant").addEventListener("click", () => {
  currentVariants = collectVariants();
  currentVariants.push({ name: "", stock: 0, imageIndex: 0, image: currentImages[0] || defaultImage });
  renderVariants();
  const rows = variantList.querySelectorAll("[data-variant-row]");
  rows[rows.length - 1]?.querySelector("[data-variant-field='name']")?.focus();
});

variantList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-variant]");
  if (!button) return;
  currentVariants = collectVariants().filter((_, index) => index !== Number(button.dataset.removeVariant));
  renderVariants();
});

document.querySelector("#addOption").addEventListener("click", () => {
  currentOptions = collectOptions();
  currentOptions.push({ name: "", priceAdjustment: 0 });
  renderOptions();
  const rows = optionList.querySelectorAll("[data-option-row]");
  rows[rows.length - 1]?.querySelector("[data-option-field='name']")?.focus();
});

document.querySelector("#addCategory").addEventListener("click", async () => {
  const input = document.querySelector("#newCategoryName");
  const label = input.value.trim();
  if (!label) {
    message("追加するタブ名を入力してください。");
    return;
  }
  if (Object.values(categoryNames).some((name) => name.toLowerCase() === label.toLowerCase())) {
    message("同じ名前のタブがすでにあります。");
    return;
  }

  const selectedCategories = getCategories();
  customCategories.push({ key: `custom-${Date.now()}`, label });
  saveCustomCategories();
  renderCategoryChecks(selectedCategories);
  renderCustomCategoryList();
  activeAdminPage = 1;
  renderList();
  input.value = "";
  await syncAfterChange(`「${label}」タブを追加しました。`);
});

customCategoryList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-category]");
  if (!button) return;
  const key = button.dataset.deleteCategory;
  const category = customCategories.find((item) => item.key === key);
  customCategories = customCategories.filter((item) => item.key !== key);
  products = products.map((product) => ({
    ...product,
    categories: (product.categories || []).filter((categoryKey) => categoryKey !== key),
  }));
  saveCustomCategories();
  savePreview();
  if (activeAdminFilter === key) activeAdminFilter = "all";
  activeAdminPage = 1;
  renderCategoryChecks(getCategories().filter((categoryKey) => categoryKey !== key));
  renderCustomCategoryList();
  renderList();
  await syncAfterChange(`「${category?.label || "追加タブ"}」を削除しました。`);
});

adminFilterTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin-filter]");
  if (!button) return;
  activeAdminFilter = button.dataset.adminFilter;
  activeAdminPage = 1;
  renderList();
});

adminPagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin-page]");
  if (!button) return;
  activeAdminPage = Number(button.dataset.adminPage || 1);
  renderList();
  document.querySelector("#list-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

optionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-option]");
  if (!button) return;
  currentOptions = collectOptions().filter((_, index) => index !== Number(button.dataset.removeOption));
  renderOptions();
});

document.querySelector("#addTestProduct").addEventListener("click", async () => {
  const suffix = products.filter((product) => product.id.startsWith("test-item")).length + 1;
  products.push({
    id: `test-item-${String(suffix).padStart(3, "0")}`,
    name: "テスト商品",
    price: 1234,
    stock: 5,
    description: "商品追加の練習用です。あとで削除できます。",
    image: "./assets/item-candles.png",
    images: ["./assets/item-candles.png", "./assets/item-flowers.png", "./assets/item-plate.png"],
    stripeUrl: "",
    options: [
      { name: "ギフト包装", priceAdjustment: 500 },
      { name: "名入れ", priceAdjustment: 800 },
    ],
    label: "TEST",
    visible: true,
    categories: ["new", "recommend"],
  });
  savePreview();
  activeAdminPage = Math.max(1, Math.ceil(products.length / adminPageSize));
  renderList();
  await syncAfterChange("テスト商品を追加しました。");
});

document.querySelector("#exportProducts").addEventListener("click", exportProducts);
document.querySelector("#resetProducts").addEventListener("click", resetProducts);
document.querySelector("#saveSheetUrl").addEventListener("click", saveSheetUrl);
document.querySelector("#sendToSheet").addEventListener("click", sendToSheet);

productList.addEventListener("click", async (event) => {
  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  const toggleId = event.target.closest("[data-toggle]")?.dataset.toggle;
  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;

  if (editId) {
    const product = products.find((item) => item.id === editId);
    if (product) fillForm(product);
    return;
  }

  if (toggleId) {
    products = products.map((item) => (item.id === toggleId ? { ...item, visible: item.visible === false } : item));
    savePreview();
    renderList();
    await syncAfterChange("表示設定を変更しました。");
    return;
  }

  if (deleteId) {
    products = products.filter((item) => item.id !== deleteId);
    savePreview();
    renderList();
    await syncAfterChange("商品を削除しました。");
  }
});

customCategories = normalizeCustomCategories(JSON.parse(localStorage.getItem(customCategoryStorageKey) || "[]"));
updateCategoryNames();
renderCategoryChecks([]);
renderCustomCategoryList();
clearForm();
sheetWebhookUrl.value = loadLocalText(sheetUrlKey) || window.ANDTETE_CONFIG?.sheetWebAppUrl || "";
sheetSyncToken.value = loadLocalText(sheetTokenKey) || "";
loadProducts();

window.addEventListener("focus", () => refreshProductsFromSheet(false));
window.setInterval(() => refreshProductsFromSheet(false), Math.max(15000, Number(window.ANDTETE_CONFIG?.refreshIntervalMs || 30000)));
