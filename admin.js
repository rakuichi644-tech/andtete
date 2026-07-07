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
const defaultImage = "./assets/item-green-bag.png";
const form = document.querySelector("#productForm");
const productList = document.querySelector("#productList");
const adminStatus = document.querySelector("#adminStatus");
const jsonOutput = document.querySelector("#jsonOutput");
const sheetWebhookUrl = document.querySelector("#sheetWebhookUrl");
const imageInput = document.querySelector("#image");
const imagePreview = document.querySelector("#imagePreview");
const imageUpload = document.querySelector("#imageUpload");
const imagePreset = document.querySelector("#imagePreset");
const imageThumbs = document.querySelector("#imageThumbs");
const variantList = document.querySelector("#variantList");
const optionList = document.querySelector("#optionList");
const maxImages = 7;

let products = [];
let editingId = "";
let currentImages = [defaultImage];
let currentVariants = [];
let currentOptions = [];

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

function savePreview() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(products));
  } catch (error) {
    message("保存容量がいっぱいです。写真を少なめにするか、公開用ファイルを作って制作担当者に渡してください。");
  }
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
          stripeUrl: String(variant.stripeUrl || "").trim(),
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
        stripeUrl: row.querySelector("[data-variant-field='stripeUrl']").value.trim(),
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
        <label class="variant-link-field">Stripe購入リンク
          <input data-variant-field="stripeUrl" value="${escapeHtml(variant.stripeUrl)}" placeholder="https://buy.stripe.com/..." />
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
        <button class="image-thumb ${index === 0 ? "active" : ""}" type="button" data-image-index="${index}" aria-label="写真${index + 1}">
          <img src="${image}" alt="登録写真${index + 1}" />
          <span>${index + 1}</span>
        </button>
      `
    )
    .join("");
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
    stripeUrl: document.querySelector("#stripeUrl").value.trim(),
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
  document.querySelector("#stripeUrl").value = product.stripeUrl || "";
  document.querySelector("#label").value = product.label || "";
  document.querySelector("#visible").checked = product.visible !== false;
  setCategories(product.categories || ["new"]);
  document.querySelector("#saveProduct").textContent = "変更を保存";
  window.scrollTo({ top: 0, behavior: "smooth" });
  message("編集したい内容を直して「変更を保存」を押してください。");
}

function renderList() {
  productList.innerHTML = products
    .map((product) => {
      const places = (product.categories || []).map((category) => categoryNames[category]).join(" / ");
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
    .join("");
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

async function loadProducts() {
  const saved = localStorage.getItem(storageKey);
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

async function saveSheetUrl() {
  const url = sheetWebhookUrl.value.trim();
  localStorage.setItem(sheetUrlKey, url);
  if (!url.startsWith("https://script.google.com/")) {
    message("Google Apps Scriptの連携URLを入力してください。");
    return;
  }
  await sendToSheet(false, "連携URLを保存し、現在の商品を同期しました。");
}

async function sendToSheet(silent = false, successText = "スプシとHPへ同期しました。反映まで数秒かかる場合があります。") {
  products = products.map((product) => ({ ...product, stock: Number(product.stock || 0) }));
  savePreview();
  const url = String(sheetWebhookUrl.value || window.ANDTETE_CONFIG?.sheetWebAppUrl || "").trim();

  if (!url.startsWith("https://script.google.com/")) {
    if (!silent) message("ブラウザ内には保存しました。全端末へ自動反映するには、Google Apps Scriptの連携URLを入力してください。");
    return false;
  }

  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ products }),
    });
    message(successText);
    return true;
  } catch (error) {
    message("スプシへ送信できませんでした。連携URLを確認してください。");
    return false;
  }
}

async function syncAfterChange(localText) {
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
    const limitedText = imageUpload.files?.length > maxImages ? "8枚目以降は登録されません。" : "";
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
  const thumb = event.target.closest("[data-image-index]");
  if (!thumb) return;
  const index = Number(thumb.dataset.imageIndex);
  const selected = currentImages[index];
  if (!selected) return;
  currentImages = [selected, ...currentImages.filter((_, imageIndex) => imageIndex !== index)];
  setImages(currentImages);
  message("メイン写真を変更しました。");
});

document.querySelector("#addVariant").addEventListener("click", () => {
  currentVariants = collectVariants();
  currentVariants.push({ name: "", stock: 0, stripeUrl: "", imageIndex: 0, image: currentImages[0] || defaultImage });
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

clearForm();
sheetWebhookUrl.value = localStorage.getItem(sheetUrlKey) || window.ANDTETE_CONFIG?.sheetWebAppUrl || "";
loadProducts();
