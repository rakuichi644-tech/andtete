const defaultProductImage = "./assets/hero-handmade.png";
const productSheetUrlKey = "andteteSheetWebhookUrl";
const cartStorageKey = "andteteCart";

function productSheetUrl() {
  return String(window.ANDTETE_CONFIG?.sheetWebAppUrl || localStorage.getItem(productSheetUrlKey) || "").trim();
}

function loadRemoteProductList(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `andteteProductPageCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => finish(new Error("商品データの取得がタイムアウトしました。")), 12000);

    function finish(error, products) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else resolve(products);
    }

    window[callbackName] = (payload) => {
      const products = Array.isArray(payload) ? payload : payload?.products;
      if (!Array.isArray(products)) {
        finish(new Error("商品データの形式が正しくありません。"));
        return;
      }
      finish(null, products);
    };
    script.onerror = () => finish(new Error("商品データを取得できませんでした。"));
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function escapeProductHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optimizeProductImageUrl(value) {
  const url = String(value || "").trim();
  if (!url.includes("drive.google.com/thumbnail")) return url;
  const id = url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w900` : url.replace(/([?&]sz=)w\\d+/i, "$1w900");
}

function productPageImages(product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : [product.image || defaultProductImage];
  const variantImages = (product.variants || []).map((variant) => variant.image).filter(Boolean);
  return [...new Set([...images, ...variantImages].map(optimizeProductImageUrl))].filter(Boolean).slice(0, 7);
}

function productPageVariants(product) {
  return Array.isArray(product.variants)
    ? product.variants.filter((variant) => variant && String(variant.name || "").trim())
    : [];
}

function productPageOptions(product) {
  return Array.isArray(product.options)
    ? product.options
        .filter((option) => option && String(option.name || "").trim())
        .map((option) => ({
          name: String(option.name || "").trim(),
          priceAdjustment: Math.max(0, Number(option.priceAdjustment || 0)),
        }))
    : [];
}

function formatProductPrice(price) {
  return `${Number(price || 0).toLocaleString("ja-JP")}円`;
}

function createCheckoutUrl(params) {
  const endpoint = productSheetUrl();
  if (!endpoint.startsWith("https://script.google.com/")) {
    return Promise.reject(new Error("決済連携URLが未設定です。"));
  }

  return new Promise((resolve, reject) => {
    const callbackName = `andteteCheckoutCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const baseQuery = {
      action: "checkout",
      callback: callbackName,
      successUrl: new URL("./cart.html?paid=1", window.location.href).href,
      cancelUrl: window.location.href,
      _: String(Date.now()),
    };
    const query = new URLSearchParams(params.cart
      ? { ...baseQuery, cart: JSON.stringify(params.cart) }
      : {
          ...baseQuery,
          productId: params.productId,
          variant: params.variant || "",
          options: (params.options || []).join(","),
          quantity: "1",
          successUrl: `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(params.productId)}&paid=1`,
        });
    const separator = endpoint.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => finish(new Error("決済画面の作成がタイムアウトしました。")), 15000);

    function finish(error, payload) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else if (payload?.ok && payload.url) resolve(payload.url);
      else reject(new Error(payload?.error || "決済画面を作成できませんでした。"));
    }

    window[callbackName] = (payload) => finish(null, payload);
    script.onerror = () => finish(new Error("決済連携に接続できませんでした。"));
    script.src = `${endpoint}${separator}${query.toString()}`;
    document.head.appendChild(script);
  });
}

function readCart() {
  const saved = readStoredText(cartStorageKey);
  try {
    const cart = JSON.parse(saved || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch (error) {
    return [];
  }
}

function writeCart(cart) {
  writeStoredText(cartStorageKey, JSON.stringify(cart));
}

function readStoredText(key) {
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

function writeStoredText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (error) {}
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/andtete; max-age=2592000; SameSite=Lax`;
}

function selectedPurchaseState(product) {
  const variantSelect = document.querySelector("[data-purchase-variant]");
  const selectedVariant = variantSelect?.options[variantSelect.selectedIndex];
  const checkedOptions = [...document.querySelectorAll("[data-addon-option]:checked")];
  const options = checkedOptions.map((input) => input.closest(".addon-option")?.querySelector("span")?.textContent.trim() || "").filter(Boolean);
  const optionTotal = checkedOptions.reduce((sum, input) => sum + Number(input.dataset.addonPrice || 0), 0);
  return {
    productId: String(product.id || ""),
    name: String(product.name || ""),
    price: Number(product.price || 0) + optionTotal,
    image: optimizeProductImageUrl(selectedVariant?.dataset.image || productPageImages(product)[0] || defaultProductImage),
    variant: selectedVariant?.dataset.variantName || "",
    options,
    quantity: 1,
  };
}

function addCurrentItemToCart(product) {
  const item = selectedPurchaseState(product);
  const key = JSON.stringify([item.productId, item.variant, item.options]);
  const cart = readCart();
  const existing = cart.find((row) => JSON.stringify([row.productId, row.variant, row.options || []]) === key);
  if (existing) existing.quantity = Math.min(20, Number(existing.quantity || 1) + 1);
  else cart.push(item);
  writeCart(cart);
  return cart.length;
}

function renderPurchaseProduct(product) {
  const container = document.querySelector("#purchaseProduct");
  const images = productPageImages(product);
  const variants = productPageVariants(product);
  const options = productPageOptions(product);
  const firstVariant = variants[0];
  const initialImage = firstVariant?.image || images[0] || defaultProductImage;

  container.innerHTML = `
    <section class="purchase-layout" data-purchase-card data-base-price="${Number(product.price || 0)}">
      <div class="purchase-gallery">
        <img class="purchase-main-image" src="${escapeProductHtml(initialImage)}" alt="${escapeProductHtml(product.name)}" decoding="async" />
        ${images.length > 1 ? `<div class="purchase-thumbs">${images.map((image, index) => `
          <button class="${index === 0 ? "active" : ""}" type="button" data-purchase-thumb="${index}" aria-label="写真${index + 1}を表示">
            <img src="${escapeProductHtml(image)}" alt="" loading="lazy" decoding="async" />
          </button>`).join("")}</div>` : ""}
      </div>

      <div class="purchase-info">
        <a class="small-link" href="./index.html#all-products">← 商品一覧へ戻る</a>
        <span class="eyebrow">select & purchase</span>
        <h1>${escapeProductHtml(product.name)}</h1>
        <p class="purchase-description">${escapeProductHtml(product.description || "")}</p>
        <p class="purchase-base-price">基本価格 ${formatProductPrice(product.price)}</p>

        ${variants.length ? `
          <fieldset class="purchase-options">
            <legend>カラー</legend>
            <label>
              <span>カラーを選択</span>
              <select data-purchase-variant>
                ${variants.map((variant, index) => `<option value="${index}" data-variant-name="${escapeProductHtml(variant.name)}" data-stock="${Number(variant.stock ?? 0)}" data-image="${escapeProductHtml(variant.image || "")}">${escapeProductHtml(variant.name)}（残り${Number(variant.stock ?? 0)}点）</option>`).join("")}
              </select>
            </label>
          </fieldset>` : ""}

        ${options.length ? `
          <fieldset class="purchase-options">
            <legend>追加オプション</legend>
            <div class="addon-list">
              ${options.map((option, index) => `
                <label class="addon-option">
                  <input type="checkbox" data-addon-option="${index}" data-addon-price="${option.priceAdjustment}" />
                  <span>${escapeProductHtml(option.name)}</span>
                  <strong>+${formatProductPrice(option.priceAdjustment)}</strong>
                </label>`).join("")}
            </div>
          </fieldset>` : ""}

        <div class="purchase-summary">
          <span>選択後の合計</span>
          <strong data-purchase-total>${formatProductPrice(product.price)}</strong>
        </div>
        <p class="purchase-stock" data-purchase-stock>${variants.length ? `残り${Number(firstVariant?.stock ?? 0)}点` : `残り${Number(product.stock ?? 0)}点`}</p>
        <div data-checkout-slot></div>
        <div class="cart-actions">
          <button class="primary-link soft-button" type="button" data-add-cart>かごに入れる</button>
          <a class="text-link" href="./cart.html">かごを見る</a>
        </div>
        <p class="cart-status" data-cart-status aria-live="polite"></p>
        <p class="checkout-note">選択内容に合わせてStripeの安全な決済画面を自動作成します。</p>
      </div>
    </section>
  `;

  updatePurchaseState(product);
}

function updatePurchaseState(product) {
  const card = document.querySelector("[data-purchase-card]");
  if (!card) return;
  const variantSelect = card.querySelector("[data-purchase-variant]");
  const selectedVariant = variantSelect ? variantSelect.options[variantSelect.selectedIndex] : null;
  const stock = selectedVariant ? Number(selectedVariant.dataset.stock || 0) : Number(product.stock ?? 0);
  const optionTotal = [...card.querySelectorAll("[data-addon-option]:checked")]
    .reduce((sum, input) => sum + Number(input.dataset.addonPrice || 0), 0);
  const total = Number(product.price || 0) + optionTotal;
  const totalNode = card.querySelector("[data-purchase-total]");
  const stockNode = card.querySelector("[data-purchase-stock]");
  const checkoutSlot = card.querySelector("[data-checkout-slot]");

  totalNode.textContent = formatProductPrice(total);
  stockNode.textContent = stock > 0 ? `残り${stock.toLocaleString("ja-JP")}点` : "在庫なし";
  stockNode.classList.toggle("soldout", stock <= 0);

  if (stock <= 0) {
    checkoutSlot.innerHTML = `<span class="disabled-link purchase-checkout">在庫なし</span>`;
  } else {
    checkoutSlot.innerHTML = `<button class="primary-link purchase-checkout" type="button" data-create-checkout>Stripe決済へ進む</button>`;
  }
}

document.addEventListener("click", (event) => {
  const addCartButton = event.target.closest("[data-add-cart]");
  if (addCartButton) {
    const count = addCurrentItemToCart(window.ANDTETE_ACTIVE_PRODUCT);
    const status = document.querySelector("[data-cart-status]");
    if (status) status.textContent = `かごに入れました。現在${count}種類の商品が入っています。`;
    return;
  }

  const checkoutButton = event.target.closest("[data-create-checkout]");
  if (checkoutButton) {
    const product = window.ANDTETE_ACTIVE_PRODUCT;
    const selected = selectedPurchaseState(product);

    checkoutButton.disabled = true;
    checkoutButton.textContent = "決済画面を作成中";
    createCheckoutUrl({
      productId: selected.productId,
      variant: selected.variant,
      options: selected.options,
    }).then((url) => {
      window.location.href = url;
    }).catch((error) => {
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Stripe決済へ進む";
      const slot = document.querySelector("[data-checkout-slot]");
      if (slot) slot.insertAdjacentHTML("beforeend", `<p class="checkout-error">${escapeProductHtml(error.message || "決済画面を作成できませんでした。")}</p>`);
    });
    return;
  }

  const thumb = event.target.closest("[data-purchase-thumb]");
  if (!thumb) return;
  const image = document.querySelector(".purchase-main-image");
  const thumbImage = thumb.querySelector("img");
  if (!image || !thumbImage) return;
  image.src = thumbImage.currentSrc || thumbImage.src;
  thumb.parentElement.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === thumb));
});

document.addEventListener("change", (event) => {
  if (!event.target.closest("[data-purchase-variant], [data-addon-option]")) return;
  const product = window.ANDTETE_ACTIVE_PRODUCT;
  const variantSelect = document.querySelector("[data-purchase-variant]");
  const selected = variantSelect?.options[variantSelect.selectedIndex];
  const image = document.querySelector(".purchase-main-image");
  if (selected?.dataset.image && image) image.src = selected.dataset.image;
  updatePurchaseState(product);
});

document.addEventListener("error", (event) => {
  const image = event.target.closest?.(".purchase-main-image, .purchase-thumbs img");
  if (!image || image.dataset.fallbackApplied) return;
  image.dataset.fallbackApplied = "true";
  image.src = defaultProductImage;
}, true);

async function loadPurchaseProduct() {
  const id = new URLSearchParams(window.location.search).get("id");
  let products = [];
  const remoteUrl = productSheetUrl();
  const previewProducts = localStorage.getItem("andteteProductsPreview");

  if (remoteUrl.startsWith("https://script.google.com/")) {
    try {
      products = await loadRemoteProductList(remoteUrl);
    } catch (error) {
      console.warn("スプレッドシートの商品取得に失敗しました。", error);
    }
  }

  if (!products.length && previewProducts) {
    products = JSON.parse(previewProducts);
  } else if (!products.length) {
    try {
      const response = await fetch("./data/products.json", { cache: "no-store" });
      if (!response.ok) throw new Error("商品データを読み込めませんでした。");
      products = await response.json();
    } catch (error) {
      products = Array.isArray(window.ANDTETE_PRODUCTS) ? window.ANDTETE_PRODUCTS : [];
    }
  }

  let product = products.find((item) => String(item.id) === String(id) && item.visible !== false);
  if (!product && previewProducts) {
    try {
      const previewList = JSON.parse(previewProducts);
      product = previewList.find((item) => String(item.id) === String(id) && item.visible !== false);
    } catch (error) {
      console.warn("ブラウザ内の商品データを読み込めませんでした。", error);
    }
  }
  if (!product) {
    document.querySelector("#purchaseProduct").innerHTML = `<section class="page-hero"><h1>商品が見つかりません</h1><a class="primary-link" href="./index.html#all-products">商品一覧へ戻る</a></section>`;
    return;
  }

  window.ANDTETE_ACTIVE_PRODUCT = product;
  document.title = `${product.name} | andtete`;
  renderPurchaseProduct(product);
}

loadPurchaseProduct();
