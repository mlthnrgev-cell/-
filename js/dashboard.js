const API_URLS = ["api.php"];
const JSON_STORE_URL = "data/store.json";
const DEFAULT_IMAGE = "assets/hero-store.svg";
const clone = (value) => JSON.parse(JSON.stringify(value));
const today = () => new Date().toISOString().slice(0, 10);
const slug = (value) => String(value || "").trim().toLowerCase().replace(/[^\w\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "") || `item-${Date.now()}`;
const ICONS = "🛍️ 🛒 🎁 🔥 ⭐ 💎 🏷️ ⌚ 📱 🎧 💻 🖥️ ⌨️ 🖱️ 📷 🎮 🔌 🔋 💡 🧢 👟 👕 👗 👔 👜 🎒 👓 🕶️ 💍 📿 🧴 🧸 🏠 🛏️ 🪑 🍽️ ☕ 🍫 🧃 🍔 🍕 🚗 🏍️ 🚲 ⚽ 🏀 🏆 📚 ✏️ 🧰 🔧 🪛 🧲 🧪 💊 🩺 🌿 🌹 🎨 🖼️ 🎵 🎤 📦 🚚 ✅ ❌ ⏳ 💬 📞 📧 📍 🌐".split(" ");

const EMPTY_STORE = {
  settings: {},
  banner: {},
  contact: {},
  categories: [],
  products: [],
  visits: 0,
  changes: []
};

let csrfToken = "";

async function apiRequest(action, options = {}) {
  let lastError = null;
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    ...(options.headers || {})
  };

  for (const apiUrl of API_URLS) {
    try {
      const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
        ...options,
        credentials: "same-origin",
        headers
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        const error = new Error(payload.error || "Request failed");
        error.status = response.status;
        error.apiUrl = apiUrl;
        error.fatal = [401, 403, 429, 413].includes(response.status);
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.fatal) throw error;
    }
  }

  throw lastError || new Error("Request failed");
}

function loginErrorMessage(error) {
  if (error?.status === 401) return "كلمة المرور غير صحيحة";
  if (error?.status === 429) return "تم إيقاف المحاولات مؤقتا. انتظر 15 دقيقة ثم جرّب مرة أخرى.";
  if (error?.status === 403) return "تم رفض طلب الدخول. افتح لوحة التحكم من نفس رابط الموقع.";
  return "تعذر الاتصال بملف الدخول. تأكد أن الموقع يعمل على سيرفر PHP أو Node وليس فتح ملف مباشر.";
}

async function loadStore() {
  try {
    const payload = await apiRequest("store");
    return { ...clone(EMPTY_STORE), ...(payload.data || {}) };
  } catch (error) {
    const response = await fetch(`${JSON_STORE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw error;
    const data = await response.json();
    return { ...clone(EMPTY_STORE), ...(data || {}) };
  }
}

function isDirectImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/upload/")) return true;
    return /\.(svg|png|jpe?g|webp|gif)(\?.*)?$/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

function normalizeImageUrl(value, fallback = DEFAULT_IMAGE) {
  const url = String(value || "").trim();
  if (!url || url.length > 500) return fallback;
  if (url.startsWith("assets/")) {
    return /^assets\/[A-Za-z0-9._\/-]+\.(svg|png|jpe?g|webp|gif)$/i.test(url) ? url : fallback;
  }
  if (!isDirectImageUrl(url)) {
    return fallback;
  }
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    if (/\/upload\/(?:[^/]+\/)*(?=v\d+\/)/.test(url)) {
      return url.replace(/\/upload\/(?:[^/]+\/)*(?=v\d+\/)/, "/upload/f_auto,q_auto,c_limit,w_900/");
    }
    return url.replace("/upload/", "/upload/f_auto,q_auto,c_limit,w_900/");
  }
  return url;
}

function parseGalleryValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeGalleryImages(value) {
  return parseGalleryValue(value).map((src) => normalizeImageUrl(src, "")).filter(Boolean).slice(0, 8);
}

function normalizeStoreImages(data) {
  if (data.banner) data.banner.image = normalizeImageUrl(data.banner.image);
  (data.categories || []).forEach((category) => {
    category.image = normalizeImageUrl(category.image);
  });
  (data.products || []).forEach((product) => {
    product.image = normalizeImageUrl(product.image);
    product.gallery = normalizeGalleryImages(product.gallery);
  });
}

async function saveStore() {
  normalizeStoreImages(store);
  const payload = await apiRequest("store", {
    method: "POST",
    body: JSON.stringify({ data: store })
  });
  store = { ...clone(EMPTY_STORE), ...(payload.data || store) };
}

function addChange(text) {
  store.changes = store.changes || [];
  store.changes.unshift(`${today()} - ${text}`);
  store.changes = store.changes.slice(0, 12);
}

let store = clone(EMPTY_STORE);
let mediaDraft = null;

function applySettingsColors() {
  const s = store.settings;
  document.documentElement.style.setProperty("--primary", s.primaryColor || "#2563EB");
  document.documentElement.style.setProperty("--secondary", s.secondaryColor || "#10B981");
  document.documentElement.style.setProperty("--button", s.buttonColor || "#F97316");
  document.documentElement.style.setProperty("--bg", s.backgroundColor || "#F8FAFC");
  document.documentElement.style.setProperty("--text", s.textColor || "#1F2937");
  document.documentElement.style.setProperty("--font", s.fontFamily || "Tahoma, Arial, sans-serif");
}

function categoryName(id) {
  return store.categories.find((cat) => cat.id === id)?.name || "بدون قسم";
}

function renderOverview() {
  const low = store.products.filter((p) => p.stock > 0 && p.stock <= 5);
  const out = store.products.filter((p) => p.stock <= 0);
  document.getElementById("statsGrid").innerHTML = [
    ["عدد المنتجات", store.products.length],
    ["عدد الأقسام", store.categories.length],
    ["عدد الزيارات", store.visits || 0],
    ["منتجات قاربت على النفاد", low.length + out.length]
  ]
    .map(([label, value]) => `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  document.getElementById("stockAlerts").innerHTML =
    [...out, ...low]
      .map(
        (p) =>
          `<div class="alert-item"><strong>${p.name}</strong><br>الكمية الحالية: ${p.stock} - ${p.stock <= 0 ? "غير متوفر" : "قارب على النفاد"}</div>`
      )
      .join("") || "<p>لا توجد تنبيهات مخزون.</p>";

  document.getElementById("recentChanges").innerHTML =
    (store.changes || []).map((c) => `<div class="alert-item">${c}</div>`).join("") || "<p>لا توجد تعديلات بعد.</p>";
}

function productRow(product) {
  return `
    <div class="admin-row">
      <img src="${product.image || "assets/hero-store.svg"}" alt="${product.name}">
      <div>
        <strong>${product.name}</strong>
        <div>${product.price} جنيه - ${categoryName(product.category)} - كمية ${product.stock}</div>
        <small>${product.visible === false ? "مخفي" : product.stock <= 0 ? "غير متوفر" : "ظاهر"}</small>
      </div>
      <div class="row-actions">
        <button type="button" data-edit-product="${product.id}">تعديل</button>
        <button type="button" data-toggle-product="${product.id}">${product.visible === false ? "إظهار" : "إخفاء"}</button>
        <button type="button" data-stock-plus="${product.id}">+ كمية</button>
        <button type="button" data-stock-minus="${product.id}">- كمية</button>
        <button type="button" class="danger" data-delete-product="${product.id}">حذف</button>
      </div>
    </div>
  `;
}

function renderProductsAdmin() {
  document.querySelector('[name="category"]').innerHTML = store.categories.map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join("");
  document.getElementById("adminProducts").innerHTML = store
    .products
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999))
    .map(productRow)
    .join("");
  bindProductRows();
}

function bindProductRows() {
  document.querySelectorAll("[data-edit-product]").forEach((button) => button.addEventListener("click", () => fillProductForm(button.dataset.editProduct)));
  document.querySelectorAll("[data-toggle-product]").forEach((button) =>
    button.addEventListener("click", () => {
      const product = store.products.find((p) => p.id === button.dataset.toggleProduct);
      product.visible = product.visible === false;
      addChange(`تم ${product.visible ? "إظهار" : "إخفاء"} المنتج ${product.name}`);
      saveAndRender();
    })
  );
  document.querySelectorAll("[data-stock-plus]").forEach((button) => button.addEventListener("click", () => changeStock(button.dataset.stockPlus, 1)));
  document.querySelectorAll("[data-stock-minus]").forEach((button) => button.addEventListener("click", () => changeStock(button.dataset.stockMinus, -1)));
  document.querySelectorAll("[data-delete-product]").forEach((button) =>
    button.addEventListener("click", () => {
      const product = store.products.find((p) => p.id === button.dataset.deleteProduct);
      store.products = store.products.filter((p) => p.id !== button.dataset.deleteProduct);
      addChange(`تم حذف المنتج ${product?.name || ""}`);
      saveAndRender();
    })
  );
}

function changeStock(id, diff) {
  const product = store.products.find((p) => p.id === id);
  product.stock = Math.max(0, Number(product.stock || 0) + diff);
  if (product.stock === 0) product.visible = product.visible !== false;
  product.updatedAt = today();
  addChange(`تم تعديل كمية ${product.name} إلى ${product.stock}`);
  saveAndRender();
}

function fillProductForm(id) {
  const product = store.products.find((p) => p.id === id);
  const form = document.getElementById("productForm");
  Object.entries(product).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (key === "gallery") {
      setGalleryField(form, value);
      return;
    }
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else form.elements[key].value = Array.isArray(value) ? value.join(", ") : value ?? "";
  });
  updateImagePreviews();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function productFromForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return {
    id: data.id || slug(data.name),
    name: data.name,
    price: Number(data.price || 0),
    oldPrice: Number(data.oldPrice || 0),
    category: data.category,
    brand: data.brand,
    color: data.color,
    size: data.size,
    specs: data.specs,
    description: data.description,
    image: normalizeImageUrl(data.image),
    gallery: normalizeGalleryImages(data.gallery),
    rating: Number(data.rating || 5),
    stock: Number(data.stock || 0),
    featured: form.elements.featured.checked,
    visible: form.elements.visible.checked,
    order: Number(data.order || store.products.length + 1),
    updatedAt: today()
  };
}

function renderCategoriesAdmin() {
  document.getElementById("adminCategories").innerHTML = store
    .categories
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999))
    .map(
      (cat) => `
    <div class="admin-row">
      <img src="${cat.image || "assets/hero-store.svg"}" alt="${cat.name}">
      <div><strong>${cat.icon || ""} ${cat.name}</strong><div>تٱتيب ${cat.order || "-"}</div></div>
      <div class="row-actions">
        <button type="button" data-edit-category="${cat.id}">تعديل</button>
        <button type="button" class="danger" data-delete-category="${cat.id}">حذف</button>
      </div>
    </div>
  `
    )
    .join("");

  document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => fillCategoryForm(button.dataset.editCategory)));
  document.querySelectorAll("[data-delete-category]").forEach((button) =>
    button.addEventListener("click", () => {
      const used = store.products.some((p) => p.category === button.dataset.deleteCategory);
      if (used) {
        alert("لا يمكن حذف قسم مستخدم في منتجات. غيّر قسم المنتجات أولا.");
        return;
      }
      const cat = store.categories.find((c) => c.id === button.dataset.deleteCategory);
      store.categories = store.categories.filter((c) => c.id !== button.dataset.deleteCategory);
      addChange(`تم حذف القسم ${cat?.name || ""}`);
      saveAndRender();
    })
  );
}

function fillCategoryForm(id) {
  const cat = store.categories.find((item) => item.id === id);
  const form = document.getElementById("categoryForm");
  Object.entries(cat).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  });
  updateImagePreviews();
  markSelectedIcon();
}

function renderForms() {
  fillObjectForm("bannerForm", store.banner);
  fillObjectForm("contactForm", store.contact);
  fillObjectForm("settingsForm", store.settings);
  renderMediaManager();
}

function fillObjectForm(formId, object) {
  const form = document.getElementById(formId);
  Object.entries(object).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else form.elements[key].value = value ?? "";
  });
  updateImagePreviews();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageValueFromFile(file) {
  if (window.SAEED_CLOUDINARY?.cloudName && window.SAEED_CLOUDINARY?.uploadPreset) {
    try {
      return await uploadImageToCloudinary(file);
    } catch (error) {
      console.error("Cloudinary upload failed", error);
      showSaveToast?.("فشل رفع الصورة على Cloudinary. لن يتم تغيير الصورة الحالية.");
      return null;
    }
  }

  showSaveToast?.("Cloudinary غير مهيأ. لن يتم حفظ الصورة المختارة.");
  return null;
}

async function uploadImageToCloudinary(file) {
  const { cloudName, uploadPreset } = window.SAEED_CLOUDINARY;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  showSaveToast("جاري رفع الصورة على Cloudinary...");
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Cloudinary upload failed: ${message}`);
  }

  const result = await response.json();
  showSaveToast("تم رفع الصورة بنجاح");
  return optimizeCloudinaryUrl(result.secure_url);
}

function optimizeCloudinaryUrl(url) {
  if (!url || !url.includes("/upload/")) return url;
  if (url.includes("/upload/f_auto,q_auto/")) return url;
  return url.replace("/upload/", "/upload/f_auto,q_auto/");
}

function setGalleryField(form, gallery) {
  form.elements.gallery.value = JSON.stringify(parseGalleryValue(gallery));
}

function imagePreviewState(input) {
  const raw = String(input.value || "").trim();
  if (!raw) {
    return {
      src: DEFAULT_IMAGE,
      message: "ضع رابط الصورة لمعاينتها هنا.",
      valid: false,
      empty: true
    };
  }

  const src = normalizeImageUrl(raw, "");
  if (!src) {
    return {
      src: DEFAULT_IMAGE,
      message: "استخدم رابط صورة مباشر ينتهي بـ jpg أو png أو webp. روابط صفحات ibb.co لا تعرض الصورة.",
      valid: false,
      empty: false
    };
  }

  return {
    src,
    message: "جار تحميل معاينة الصورة...",
    valid: true,
    empty: false
  };
}

function updateImagePreviews() {
  document.querySelectorAll("[data-image-target]").forEach((input) => {
    const preview = document.getElementById(input.dataset.imageTarget);
    const status = input.dataset.previewStatus ? document.getElementById(input.dataset.previewStatus) : null;
    const state = imagePreviewState(input);
    if (!preview) return;

    preview.onload = null;
    preview.onerror = null;
    preview.classList.toggle("preview-placeholder", !state.valid);
    preview.src = state.src;

    if (status) {
      status.textContent = state.message;
      status.classList.toggle("error", !state.valid && !state.empty);
      status.classList.toggle("success", false);
    }

    if (state.valid && status) {
      preview.onload = () => {
        status.textContent = "تم تحميل معاينة الصورة.";
        status.classList.add("success");
        status.classList.remove("error");
      };
      preview.onerror = () => {
        preview.src = DEFAULT_IMAGE;
        status.textContent = "تعذر تحميل الصورة من هذا الرابط.";
        status.classList.add("error");
        status.classList.remove("success");
      };
    }
  });

  const galleryField = document.getElementById("productForm").elements.gallery;
  const gallery = normalizeGalleryImages(galleryField.value);
  const galleryStatus = document.getElementById("productGalleryStatus");

  document.getElementById("productGalleryPreview").innerHTML = gallery
    .map((src) => `<img src="${src}" alt="صورة معرض">`)
    .join("");

  if (galleryStatus) {
    galleryStatus.textContent = gallery.length
      ? `تم تحميل ${gallery.length} صورة للمعرض.`
      : "ضع روابط صور مباشرة تنتهي بـ jpg أو png أو webp. رابط صفحة ibb.co لا يكفي.";
    galleryStatus.classList.toggle("success", gallery.length > 0);
    galleryStatus.classList.toggle("error", Boolean(galleryField.value.trim()) && gallery.length === 0);
  }
}

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function mediaItems() {
  const items = [
    { key: "banner:image", title: "صورة بداية الموقع / البانر الٱئيسي", value: store.banner.image || "assets/hero-store.svg" }
  ];
  store.categories
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999))
    .forEach((category) => {
      items.push({
        key: `category:${category.id}:image`,
        title: `صورة قسم ${category.icon || ""} ${category.name}`,
        value: category.image || "assets/hero-store.svg"
      });
    });

  store.products
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999))
    .forEach((product) => {
      items.push({ key: `product:${product.id}:image`, title: `الصورة الرئيسية للمنتج ${product.name}`, value: product.image || "assets/hero-store.svg" });
      parseGalleryValue(product.gallery).forEach((src, index) => {
        items.push({ key: `product:${product.id}:gallery:${index}`, title: `صورة معرض ${index + 1} - ${product.name}`, value: src || "assets/hero-store.svg" });
      });
    });

  return items;
}

function renderMediaManager() {
  const manager = document.getElementById("mediaManager");
  if (!manager) return;

  const items = mediaItems();
  if (!mediaDraft) mediaDraft = Object.fromEntries(items.map((item) => [item.key, item.value]));

  manager.innerHTML = items
    .map((item) => {
      const value = normalizeImageUrl(mediaDraft[item.key] || item.value);
      return `
      <div class="media-row" data-media-row="${escapeAttr(item.key)}">
        <img src="${escapeAttr(value)}" alt="${escapeAttr(item.title)}">
        <div class="media-fields">
          <h3>${escapeAttr(item.title)}</h3>
          <label>رابط الصورة الاحتياطي<input value="${escapeAttr(value)}" data-media-key="${escapeAttr(item.key)}" placeholder="ضع رابط صورة مباشر"></label>
          <div class="media-actions">
            <label class="secondary-button">تحميل صورة من الجهاز<input type="file" accept="image/*" data-media-upload="${item.key}" hidden></label>
            <button class="text-button" type="button" data-media-clear="${item.key}">استخدام الصورة الافتراضية</button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  bindMediaManagerRows();
}

function setMediaDirty(isDirty = true) {
  const hint = document.querySelector("#tab-media .save-hint");
  if (!hint) return;
  hint.classList.toggle("dirty", isDirty);
  hint.textContent = isDirty
    ? "يوجد تعديلات غير محفوظة. اضغط حفظ التعديلات."
    : "تم حفظ التعديلات. يمكنك تعديل صور أخرى عند الحاجة.";
}

function bindMediaManagerRows() {
  document.querySelectorAll("[data-media-key]").forEach((input) => {
    input.addEventListener("input", () => {
      mediaDraft[input.dataset.mediaKey] = input.value;
      const row = input.closest(".media-row");
      row.querySelector("img").src = normalizeImageUrl(input.value);
      setMediaDirty(true);
    });
  });

  document.querySelectorAll("[data-media-upload]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await imageValueFromFile(file);
        if (dataUrl) {
          const key = input.dataset.mediaUpload;
          mediaDraft[key] = normalizeImageUrl(dataUrl);
          const row = input.closest(".media-row");
          row.querySelector("img").src = mediaDraft[key];
          row.querySelector("[data-media-key]").value = mediaDraft[key];
          setMediaDirty(true);
        }
      } catch (error) {
        console.error(error);
        showSaveToast("فشل رفع الصورة. راجع إعدادات Cloudinary أو الاتصال.");
      } finally {
        input.value = "";
      }
    });
  });

  document.querySelectorAll("[data-media-clear]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.mediaClear;
      mediaDraft[key] = "assets/hero-store.svg";
      const row = button.closest(".media-row");
      row.querySelector("img").src = mediaDraft[key];
      row.querySelector("[data-media-key]").value = mediaDraft[key];
      setMediaDirty(true);
    });
  });
}

function applyMediaChanges() {
  Object.entries(mediaDraft || {}).forEach(([key, value]) => {
    const parts = key.split(":");
    const imageValue = normalizeImageUrl(value);

    if (parts[0] === "banner") {
      store.banner.image = imageValue;
      return;
    }

    if (parts[0] === "category") {
      const category = store.categories.find((item) => item.id === parts[1]);
      if (category) category.image = imageValue;
      return;
    }

    if (parts[0] === "product") {
      const product = store.products.find((item) => item.id === parts[1]);
      if (!product) return;
      if (parts[2] === "image") product.image = imageValue;
      if (parts[2] === "gallery") {
        product.gallery = product.gallery || [];
        product.gallery[Number(parts[3])] = normalizeImageUrl(value);
      }

      product.updatedAt = today();
    }
  });

  addChange("تم حفظ تعديلات الصور والمحتوى");
  mediaDraft = null;
  saveAndRender();
  setMediaDirty(false);
}

function bindUploads() {
  document.querySelectorAll("[data-upload-to]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        const [formId, fieldName] = input.dataset.uploadTo.split(":");
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await imageValueFromFile(file);
        if (dataUrl) {
          document.getElementById(formId).elements[fieldName].value = normalizeImageUrl(dataUrl);
          updateImagePreviews();
        }
      } catch (error) {
        console.error(error);
        showSaveToast("فشل رفع الصورة. راجع إعدادات Cloudinary أو الاتصال.");
      } finally {
        input.value = "";
      }
    });
  });

  document.querySelectorAll("[data-upload-gallery]").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        const [formId, fieldName] = input.dataset.uploadGallery.split(":");
        const files = [...(input.files || [])];
        if (!files.length) return;
        const form = document.getElementById(formId);
        const current = parseGalleryValue(form.elements[fieldName].value);
        const urls = await Promise.all(files.map((file) => imageValueFromFile(file)));
        const merged = [...current, ...urls].filter(Boolean);
        form.elements[fieldName].value = JSON.stringify(merged.length ? merged : current);
        updateImagePreviews();
      } catch (error) {
        console.error(error);
        showSaveToast("فشل رفع صورة من صور المعرض. راجع إعدادات Cloudinary أو الاتصال.");
      } finally {
        input.value = "";
      }
    });
  });

  document.querySelectorAll("[data-image-target]").forEach((input) => {
    input.addEventListener("input", updateImagePreviews);
  });

  document.getElementById("productForm").elements.gallery.addEventListener("input", updateImagePreviews);
}

function renderIconPicker() {
  const picker = document.getElementById("iconPicker");
  picker.innerHTML = ICONS.map((icon) => `<button type="button" data-icon="${icon}" title="${icon}">${icon}</button>`).join("");
  picker.querySelectorAll("[data-icon]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("categoryForm").elements.icon.value = button.dataset.icon;
      markSelectedIcon();
    });
  });
  document.getElementById("categoryForm").elements.icon.addEventListener("input", markSelectedIcon);
  markSelectedIcon();
}

function markSelectedIcon() {
  const selected = document.getElementById("categoryForm").elements.icon.value;
  document.querySelectorAll("[data-icon]").forEach((button) => {
    button.classList.toggle("active", button.dataset.icon === selected);
  });
}

function objectFromForm(form) {
  const data = {};
  [...form.elements].forEach((el) => {
    if (!el.name) return;
    data[el.name] = el.type === "checkbox" ? el.checked : el.value;
  });
  return data;
}

function bindForms() {
  document.getElementById("productForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const product = productFromForm(event.currentTarget);
    const index = store.products.findIndex((p) => p.id === product.id);
    if (index >= 0) store.products[index] = product;
    else store.products.push(product);
    addChange(`تم حفظ المنتج ${product.name}`);
    event.currentTarget.reset();
    event.currentTarget.elements.visible.checked = true;
    saveAndRender();
  });

  document.getElementById("clearProductForm").addEventListener("click", () => {
    document.getElementById("productForm").reset();
    document.getElementById("productForm").elements.visible.checked = true;
    updateImagePreviews();
  });

  document.getElementById("categoryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = objectFromForm(event.currentTarget);
    const category = {
      id: data.id || slug(data.name),
      name: data.name,
      icon: data.icon,
      image: normalizeImageUrl(data.image),
      order: Number(data.order || store.categories.length + 1)
    };
    const index = store.categories.findIndex((cat) => cat.id === category.id);
    if (index >= 0) store.categories[index] = category;
    else store.categories.push(category);
    addChange(`تم حفظ القسم ${category.name}`);
    event.currentTarget.reset();
    saveAndRender();
    markSelectedIcon();
  });

  document.getElementById("bannerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    store.banner = {
      ...store.banner,
      ...objectFromForm(event.currentTarget),
      image: normalizeImageUrl(event.currentTarget.elements.image.value)
    };
    addChange("تم حفظ البانر الرئيسي");
    saveAndRender();
  });

  document.getElementById("contactForm").addEventListener("submit", (event) => {
    event.preventDefault();
    store.contact = objectFromForm(event.currentTarget);
    addChange("تم حفظ بيانات التواصل");
    saveAndRender();
  });

  document.getElementById("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    store.settings = {
      ...store.settings,
      ...objectFromForm(event.currentTarget)
    };
    addChange("تم حفظ إعدادات الموقع");
    saveAndRender();
  });
}

function bindTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-admin-tab]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      document.querySelectorAll(".admin-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.id === `tab-${button.dataset.adminTab}`);
      });
    });
  });
}

function syncActiveFormBeforeSave() {
  const activeTab = document.querySelector(".admin-tab.active");
  if (!activeTab) return false;

  if (activeTab.id === "tab-contact") {
    store.contact = objectFromForm(document.getElementById("contactForm"));
    addChange("تم حفظ بيانات التواصل");
    return true;
  }

  if (activeTab.id === "tab-settings") {
    const form = document.getElementById("settingsForm");
    store.settings = {
      ...store.settings,
      ...objectFromForm(form)
    };
    addChange("تم حفظ إعدادات الموقع");
    return true;
  }

  if (activeTab.id === "tab-banners") {
    const form = document.getElementById("bannerForm");
    store.banner = {
      ...store.banner,
      ...objectFromForm(form),
      image: normalizeImageUrl(form.elements.image.value)
    };
    addChange("تم حفظ البانر الرئيسي");
    return true;
  }

  return false;
}

function bindDataActions() {
  document.getElementById("saveDashboardChanges").addEventListener("click", () => {
    syncActiveFormBeforeSave();
    saveAndRender();
  });
  document.getElementById("saveMediaChanges").addEventListener("click", applyMediaChanges);
}

function showSaveToast(message) {
  const toast = document.getElementById("saveToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showSaveToast.timer);
  showSaveToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2500);
}

function unlockDashboard(gate) {
  gate.classList.add("hidden");
  saveAndRender({ persist: false });
}

function bindPasswordGate(authenticated) {
  const gate = document.getElementById("passwordGate");
  if (authenticated) {
    unlockDashboard(gate);
  }
  document.getElementById("passwordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = event.currentTarget.elements.password.value;
    try {
      await apiRequest("login", {
        method: "POST",
        body: JSON.stringify({ password })
      }).then((payload) => {
        csrfToken = payload.csrfToken || csrfToken;
      });
      unlockDashboard(gate);
    } catch (error) {
      document.getElementById("passwordError").textContent = loginErrorMessage(error);
    }
  });
}

async function saveAndRender(options = {}) {
  const { persist = true } = options;
  if (persist) {
    try {
      await saveStore();
      showSaveToast("تم حفظ التعديلات بنجاح");
    } catch (error) {
      console.error(error);
      showSaveToast("فشل الحفظ. سجل الدخول مرة أخرى.");
      return;
    }
  }
  applySettingsColors();
  renderOverview();
  renderProductsAdmin();
  renderCategoriesAdmin();
  renderForms();
}

async function initializeDashboard() {
  try {
    store = await loadStore();
  } catch (error) {
    console.error("Store load failed", error);
  }

  applySettingsColors();
  bindTabs();
  bindForms();
  bindDataActions();
  bindUploads();
  renderIconPicker();
  saveAndRender({ persist: false });

  try {
    const session = await apiRequest("session");
    csrfToken = session.csrfToken || "";
    bindPasswordGate(Boolean(session.authenticated));
  } catch (error) {
    bindPasswordGate(false);
  }

  document.body.classList.add("page-ready");
}

initializeDashboard();
