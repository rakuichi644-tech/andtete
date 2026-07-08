const categoryLabels = {
  new: "新商品",
  recommend: "おすすめ",
  preorder: "予約商品",
  stock: "即納",
};

const cartStorageKey = "andteteCart";
let quickCartLastTap = 0;

function formatPrice(price) {
  return `${Number(price).toLocaleString("ja-JP")}円`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optimizeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url.includes("drive.google.com/thumbnail")) return url;
  const id = url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w900` : url.replace(/([?&]sz=)w\\d+/i, "$1w900");
}

function productImages(product) {
  const baseImages = Array.isArray(product.images) && product.images.length ? product.images : [product.image || "./assets/hero-handmade.png"];
  const variantImages = productVariants(product).map((variant) => variant.image).filter(Boolean);
  return [...new Set([...baseImages, ...variantImages].map(optimizeImageUrl))].filter(Boolean).slice(0, 7);
}

function productVariants(product) {
  return Array.isArray(product.variants)
    ? product.variants
        .filter((variant) => variant && String(variant.name || "").trim())
        .map((variant) => ({
          name: String(variant.name || "").trim(),
          stock: variant.stock === "" || variant.stock == null ? product.stock : Number(variant.stock),
          image: optimizeImageUrl(variant.image),
        }))
    : [];
}

function stockText(stockValue) {
  const stock = Number(stockValue ?? 1);
  if (stock <= 0) return "在庫なし";
  return `残り${stock.toLocaleString("ja-JP")}点`;
}

function cartIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  `;
}

function purchaseMarkup(productId, stockValue) {
  const inStock = Number(stockValue ?? 1) > 0;
  return inStock
    ? `<a class="buy-link detail-link" href="./product.html?id=${encodeURIComponent(productId)}">商品ページへ</a>
       <button class="quick-cart-button" type="button" data-add-card-cart aria-label="かごに入れる">${cartIconSvg()}</button>`
    : `<span class="disabled-link">在庫なし</span>`;
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

function addListProductToCart(product, card) {
  const variantSelect = card?.querySelector("[data-variant-select]");
  const selectedVariant = variantSelect?.options[variantSelect.selectedIndex];
  const variant = selectedVariant?.textContent.trim() || "";
  const stock = Number(selectedVariant?.dataset.stock || product.stock || 0);
  if (stock <= 0) return { ok: false, message: "在庫がありません。" };

  const image = optimizeImageUrl(selectedVariant?.dataset.image || card?.querySelector(".product-main-image")?.currentSrc || card?.querySelector(".product-main-image")?.src || productImages(product)[0] || "./assets/hero-handmade.png");
  const item = {
    productId: String(product.id || ""),
    name: String(product.name || ""),
    price: Number(product.price || 0),
    image,
    variant,
    options: [],
    quantity: 1,
  };
  const key = JSON.stringify([item.productId, item.variant, item.options]);
  const cart = readCart();
  const existing = cart.find((row) => JSON.stringify([row.productId, row.variant, row.options || []]) === key);
  if (existing) existing.quantity = Math.min(20, Number(existing.quantity || 1) + 1);
  else cart.push(item);
  writeCart(cart);
  return { ok: true, count: cart.reduce((sum, row) => sum + Number(row.quantity || 1), 0) };
}

function showCartToast(text) {
  let toast = document.querySelector("[data-cart-toast]");
  if (!toast) {
    toast = document.createElement("p");
    toast.className = "cart-toast";
    toast.dataset.cartToast = "";
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showCartToast.timer);
  showCartToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function productCard(product) {
  const images = productImages(product);
  const image = images[0] || "./assets/hero-handmade.png";
  const variants = productVariants(product);
  const firstVariant = variants[0];
  const activeStock = firstVariant ? firstVariant.stock : product.stock;
  const label = product.label || product.categories?.map((category) => categoryLabels[category]).find(Boolean) || "商品";
  const description = product.description ? `<small>${product.description}</small>` : "";
  const thumbs = images.length > 1
    ? `<div class="product-thumbs" aria-label="${escapeHtml(product.name)}の写真">
        ${images
          .map(
            (thumb, index) => `
              <button class="${index === 0 ? "active" : ""}" type="button" data-product-thumb="${index}" aria-label="写真${index + 1}を表示">
                <img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async" />
              </button>
            `
          )
          .join("")}
      </div>`
    : "";
  const variantSelect = variants.length
    ? `<label class="variant-select-label">カラー
        <select data-variant-select>
          ${variants
            .map(
              (variant, index) => `
                <option
                  value="${index}"
                  data-stock="${escapeHtml(variant.stock)}"
                  data-image="${escapeHtml(variant.image || "")}"
                >${escapeHtml(variant.name)}</option>
              `
            )
            .join("")}
        </select>
      </label>`
    : "";

  return `
    <article class="product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="product-media">
        <img class="product-main-image" src="${escapeHtml(firstVariant?.image || image)}" alt="${escapeHtml(product.name)}" loading="lazy" decoding="async" />
        <span class="badge">${escapeHtml(label)}</span>
      </div>
      ${thumbs}
      <div class="product-info">
        <div class="product-line">
          <p>${escapeHtml(product.name)}</p>
          <span>${formatPrice(product.price)}</span>
        </div>
        ${variantSelect}
        <div class="stock-line ${Number(activeStock ?? 1) <= 0 ? "soldout" : ""}">${stockText(activeStock)}</div>
        ${description}
        <div class="product-actions">
          <span class="purchase-slot">${purchaseMarkup(product.id, activeStock)}</span>
        </div>
      </div>
    </article>
  `;
}

let allProductsCache = [];
let activeListCategory = "new";
let activeGridSize = localStorage.getItem("andteteListGridSize") || "3";
const productsStorageKey = "andteteProductsPreview";
const sheetUrlStorageKey = "andteteSheetWebhookUrl";
const customCategoriesStorageKey = "andteteCustomCategories";
let customerCustomCategories = [];

function normalizeCustomerCategories(categories) {
  return Array.isArray(categories)
    ? categories.filter((category) => category && String(category.key || "").startsWith("custom-") && String(category.label || "").trim())
    : [];
}

function renderCustomerCategoryTabs(categories = customerCustomCategories) {
  customerCustomCategories = normalizeCustomerCategories(categories);
  const container = document.querySelector("#customerCategoryTabs");
  if (!container) return;
  const tabs = [
    { key: "new", label: "NEW ARRIVALS" },
    { key: "recommend", label: "おすすめ" },
    { key: "preorder", label: "予約商品" },
    { key: "stock", label: "即納商品" },
    ...customerCustomCategories,
  ];
  if (!tabs.some((tab) => tab.key === activeListCategory)) activeListCategory = "new";
  container.innerHTML = tabs
    .map((tab) => `<button class="${tab.key === activeListCategory ? "active" : ""}" type="button" data-list-tab="${escapeHtml(tab.key)}" role="tab" aria-selected="${tab.key === activeListCategory}">${escapeHtml(tab.label)}</button>`)
    .join("");
}

function sheetDataUrl() {
  return String(window.ANDTETE_CONFIG?.sheetWebAppUrl || localStorage.getItem(sheetUrlStorageKey) || "").trim();
}

function loadRemoteProducts(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `andteteProductsCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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
      const categories = Array.isArray(payload?.categories) ? payload.categories : [];
      if (!Array.isArray(products)) {
        finish(new Error("商品データの形式が正しくありません。"));
        return;
      }
      finish(null, { products, categories });
    };

    script.onerror = () => finish(new Error("商品データを取得できませんでした。"));
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function renderProducts(products, categories = customerCustomCategories) {
  allProductsCache = products;
  renderCustomerCategoryTabs(categories);
  document.querySelectorAll("[data-products]").forEach((container) => {
    const category = container.dataset.products;
    const items = products.filter((product) => product.visible !== false && product.categories?.includes(category));
    container.innerHTML = items.length
      ? items.map(productCard).join("")
      : `<p class="empty-message">現在掲載中の商品はありません。</p>`;
  });
  renderListProducts(activeListCategory);
}

function renderListProducts(category) {
  const container = document.querySelector("[data-list-products]");
  if (!container) return;
  activeListCategory = category;
  container.dataset.gridSize = activeGridSize;
  const items = allProductsCache.filter((product) => product.visible !== false && product.categories?.includes(category));
  container.innerHTML = items.length
    ? items.map(productCard).join("")
    : `<p class="empty-message">現在掲載中の商品はありません。</p>`;
  document.querySelectorAll("[data-list-tab]").forEach((button) => {
    const active = button.dataset.listTab === category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-grid-size-button]").forEach((button) => {
    const active = button.dataset.gridSizeButton === activeGridSize;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

document.addEventListener("click", (event) => {
  const listTab = event.target.closest("[data-list-tab]");
  if (listTab) {
    renderListProducts(listTab.dataset.listTab);
    return;
  }

  const gridSize = event.target.closest("[data-grid-size-button]");
  if (gridSize) {
    activeGridSize = gridSize.dataset.gridSizeButton;
    localStorage.setItem("andteteListGridSize", activeGridSize);
    renderListProducts(activeListCategory);
    return;
  }

  const openList = event.target.closest("[data-open-list]");
  if (openList) {
    renderListProducts(openList.dataset.openList);
    return;
  }

  if (handleQuickCartTap(event)) {
    return;
  }

  const thumb = event.target.closest("[data-product-thumb]");
  if (thumb) {
    const card = thumb.closest(".product-card");
    const image = card?.querySelector(".product-main-image");
    const thumbImage = thumb.querySelector("img");
    if (!image || !thumbImage) return;
    image.src = thumbImage.currentSrc || thumbImage.src;
    thumb.parentElement.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === thumb));
    return;
  }

});

document.addEventListener("touchend", handleQuickCartTap, { passive: false });

function handleQuickCartTap(event) {
  const quickCart = event.target.closest?.("[data-add-card-cart]");
  if (!quickCart) return false;
  const now = Date.now();
  if (now - quickCartLastTap < 450) return true;
  quickCartLastTap = now;
  event.preventDefault?.();
  event.stopPropagation?.();

  const card = quickCart.closest(".product-card");
  const product = allProductsCache.find((item) => String(item.id || "") === String(card?.dataset.productId || ""));
  if (!product || !card) return true;
  const result = addListProductToCart(product, card);
  showCartToast(result.ok ? `かごに追加しました。現在${result.count}点入っています。` : result.message);
  return true;
}

document.addEventListener("change", (event) => {
  const variantSelect = event.target.closest("[data-variant-select]");
  if (!variantSelect) return;
  const card = variantSelect.closest(".product-card");
  const selected = variantSelect.options[variantSelect.selectedIndex];
  const stock = Number(selected.dataset.stock || 0);
  const variantImage = selected.dataset.image || "";
  const stockLine = card?.querySelector(".stock-line");
  const purchaseSlot = card?.querySelector(".purchase-slot");
  const image = card?.querySelector(".product-main-image");

  if (stockLine) {
    stockLine.textContent = stockText(stock);
    stockLine.classList.toggle("soldout", stock <= 0);
  }
  if (purchaseSlot) purchaseSlot.innerHTML = purchaseMarkup(card?.dataset.productId || "", stock);
  if (variantImage && image) image.src = variantImage;
});

document.addEventListener("error", (event) => {
  const image = event.target.closest?.(".product-main-image, .product-thumbs img");
  if (!image || image.dataset.fallbackApplied) return;
  image.dataset.fallbackApplied = "true";
  image.src = "./assets/hero-handmade.png";
}, true);

function setupSliders() {
  const sliders = new Map(
    [...document.querySelectorAll("[data-slider]")].map((slider) => [slider.dataset.slider, slider])
  );

  function scrollSlider(name, direction) {
    const slider = sliders.get(name);
    if (!slider) return;

    const card = slider.querySelector(".product-card");
    const gap = Number.parseFloat(getComputedStyle(slider).columnGap) || 16;
    const distance = card ? card.getBoundingClientRect().width + gap : slider.clientWidth * 0.8;

    slider.scrollBy({
      left: distance * direction,
      behavior: "smooth",
    });
  }

  document.querySelectorAll("[data-slider-prev]").forEach((button) => {
    button.addEventListener("click", () => scrollSlider(button.dataset.sliderPrev, -1));
  });

  document.querySelectorAll("[data-slider-next]").forEach((button) => {
    button.addEventListener("click", () => scrollSlider(button.dataset.sliderNext, 1));
  });

  document.querySelectorAll(".product-slider").forEach((slider) => {
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    slider.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a, select, input")) return;
      isDown = true;
      startX = event.pageX;
      scrollLeft = slider.scrollLeft;
      slider.setPointerCapture(event.pointerId);
    });

    slider.addEventListener("pointermove", (event) => {
      if (!isDown) return;
      slider.scrollLeft = scrollLeft - (event.pageX - startX);
    });

    slider.addEventListener("pointerup", () => {
      isDown = false;
    });

    slider.addEventListener("pointercancel", () => {
      isDown = false;
    });
  });
}

async function loadProducts() {
  if (!document.querySelector("[data-products]")) return;

  const remoteUrl = sheetDataUrl();
  if (remoteUrl.startsWith("https://script.google.com/")) {
    try {
      const remoteData = await loadRemoteProducts(remoteUrl);
      if (remoteData.products.length) {
        renderProducts(remoteData.products, remoteData.categories);
        setupSliders();
        return;
      }
    } catch (error) {
      console.warn("スプレッドシートの商品取得に失敗したため、ブラウザ内の商品を表示します。", error);
    }
  }

  const previewProducts = localStorage.getItem(productsStorageKey);
  const previewCategories = normalizeCustomerCategories(JSON.parse(localStorage.getItem(customCategoriesStorageKey) || "[]"));
  if (previewProducts) {
    renderProducts(JSON.parse(previewProducts), previewCategories);
    setupSliders();
    return;
  }

  try {
    const response = await fetch("./data/products.json", { cache: "no-store" });
    if (!response.ok) throw new Error("商品データを読み込めませんでした。");
    const products = await response.json();
    renderProducts(products, previewCategories);
    setupSliders();
  } catch (error) {
    if (Array.isArray(window.ANDTETE_PRODUCTS)) {
      renderProducts(window.ANDTETE_PRODUCTS, previewCategories);
      setupSliders();
      return;
    }

    document.querySelectorAll("[data-products]").forEach((container) => {
      container.innerHTML = `<p class="empty-message">商品データの読み込みに失敗しました。</p>`;
    });
    console.error(error);
  }
}

loadProducts();

window.addEventListener("storage", (event) => {
  if (event.key === customCategoriesStorageKey && event.newValue) {
    try {
      renderCustomerCategoryTabs(JSON.parse(event.newValue));
      renderListProducts(activeListCategory);
    } catch (error) {
      console.warn("更新された商品タブを読み込めませんでした。", error);
    }
    return;
  }
  if (event.key !== productsStorageKey || !event.newValue) return;
  try {
    const categories = JSON.parse(localStorage.getItem(customCategoriesStorageKey) || "[]");
    renderProducts(JSON.parse(event.newValue), categories);
  } catch (error) {
    console.warn("更新された商品データを読み込めませんでした。", error);
  }
});

window.addEventListener("focus", () => {
  const previewProducts = localStorage.getItem(productsStorageKey);
  if (!previewProducts) return;
  try {
    const categories = JSON.parse(localStorage.getItem(customCategoriesStorageKey) || "[]");
    renderProducts(JSON.parse(previewProducts), categories);
  } catch (error) {
    console.warn("商品データを再読み込みできませんでした。", error);
  }
});

const refreshInterval = Math.max(15000, Number(window.ANDTETE_CONFIG?.refreshIntervalMs || 30000));
window.setInterval(async () => {
  const remoteUrl = sheetDataUrl();
  if (!remoteUrl.startsWith("https://script.google.com/")) return;
  try {
    const data = await loadRemoteProducts(remoteUrl);
    if (data.products.length) renderProducts(data.products, data.categories);
  } catch (error) {
    console.warn("商品の自動更新を次回再試行します。", error);
  }
}, refreshInterval);

if (window.lucide) {
  window.lucide.createIcons();
}
