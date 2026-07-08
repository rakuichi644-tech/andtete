const cartStorageKey = "andteteCart";
const cartSheetUrlKey = "andteteSheetWebhookUrl";

function cartEndpoint() {
  return String(window.ANDTETE_CONFIG?.sheetWebAppUrl || localStorage.getItem(cartSheetUrlKey) || "").trim();
}

function escapeCartHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optimizeCartImageUrl(value) {
  const url = String(value || "").trim();
  if (!url.includes("drive.google.com/thumbnail")) return url;
  const id = url.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w900` : url.replace(/([?&]sz=)w\\d+/i, "$1w900");
}

function yen(value) {
  return `${Number(value || 0).toLocaleString("ja-JP")}円`;
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

function removeCart() {
  try {
    localStorage.removeItem(cartStorageKey);
  } catch (error) {}
  try {
    sessionStorage.removeItem(cartStorageKey);
  } catch (error) {}
  document.cookie = `${cartStorageKey}=; path=/andtete; max-age=0; SameSite=Lax`;
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

function optionText(item) {
  const parts = [];
  if (item.variant) parts.push(`カラー: ${item.variant}`);
  if (Array.isArray(item.options) && item.options.length) parts.push(`オプション: ${item.options.join(" / ")}`);
  return parts.join(" / ");
}

function cartLineTotal(item) {
  return Number(item.price || 0) * Number(item.quantity || 1);
}

function renderCart() {
  const items = readCart();
  const container = document.querySelector("#cartItems");
  const totalNode = document.querySelector("#cartTotal");
  const checkoutButton = document.querySelector("#cartCheckout");
  const total = items.reduce((sum, item) => sum + cartLineTotal(item), 0);

  totalNode.textContent = yen(total);
  checkoutButton.disabled = !items.length;
  container.innerHTML = items.length
    ? items.map((item, index) => `
      <article class="cart-item">
        <img src="${escapeCartHtml(optimizeCartImageUrl(item.image || "./assets/hero-handmade.png"))}" alt="${escapeCartHtml(item.name)}" loading="lazy" decoding="async" />
        <div>
          <h2>${escapeCartHtml(item.name)}</h2>
          <p>${escapeCartHtml(optionText(item) || "通常商品")}</p>
          <strong>${yen(item.price)}</strong>
        </div>
        <div class="cart-quantity">
          <button type="button" data-cart-minus="${index}" aria-label="数量を減らす">-</button>
          <span>${Number(item.quantity || 1)}</span>
          <button type="button" data-cart-plus="${index}" aria-label="数量を増やす">+</button>
        </div>
        <button class="cart-remove" type="button" data-cart-remove="${index}">削除</button>
      </article>
    `).join("")
    : `<p class="empty-message">かごに商品は入っていません。</p>`;
}

function createCartCheckout(cart) {
  const endpoint = cartEndpoint();
  if (!endpoint.startsWith("https://script.google.com/")) {
    return Promise.reject(new Error("決済連携URLが未設定です。"));
  }

  return new Promise((resolve, reject) => {
    const callbackName = `andteteCartCheckout_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const script = document.createElement("script");
    const query = new URLSearchParams({
      action: "checkout",
      callback: callbackName,
      cart: JSON.stringify(cart.map((item) => ({
        productId: item.productId,
        variant: item.variant || "",
        options: Array.isArray(item.options) ? item.options : [],
        quantity: Number(item.quantity || 1),
      }))),
      successUrl: `${window.location.origin}${window.location.pathname}?paid=1`,
      cancelUrl: window.location.href,
      _: String(Date.now()),
    });
    const separator = endpoint.includes("?") ? "&" : "?";
    const timeout = window.setTimeout(() => finish(new Error("決済画面の作成がタイムアウトしました。")), 18000);

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

document.addEventListener("click", (event) => {
  const plus = event.target.closest("[data-cart-plus]");
  const minus = event.target.closest("[data-cart-minus]");
  const remove = event.target.closest("[data-cart-remove]");
  const cart = readCart();

  if (plus) {
    const index = Number(plus.dataset.cartPlus);
    cart[index].quantity = Math.min(20, Number(cart[index].quantity || 1) + 1);
    writeCart(cart);
    renderCart();
    return;
  }

  if (minus) {
    const index = Number(minus.dataset.cartMinus);
    cart[index].quantity = Math.max(1, Number(cart[index].quantity || 1) - 1);
    writeCart(cart);
    renderCart();
    return;
  }

  if (remove) {
    cart.splice(Number(remove.dataset.cartRemove), 1);
    writeCart(cart);
    renderCart();
  }
});

document.querySelector("#cartCheckout").addEventListener("click", async () => {
  const button = document.querySelector("#cartCheckout");
  const status = document.querySelector("#cartStatus");
  const cart = readCart();
  if (!cart.length) return;
  button.disabled = true;
  button.textContent = "決済画面を作成中";
  status.textContent = "";
  try {
    const url = await createCartCheckout(cart);
    window.location.href = url;
  } catch (error) {
    button.disabled = false;
    button.textContent = "まとめてStripe決済へ";
    status.textContent = error.message || "決済画面を作成できませんでした。";
  }
});

if (new URLSearchParams(window.location.search).get("paid") === "1") {
  removeCart();
}
renderCart();
