<?php
declare(strict_types=1);

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

session_start([
    'cookie_httponly' => true,
    'cookie_samesite' => 'Strict',
    'cookie_secure' => $isHttps,
]);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header('X-Frame-Options: DENY');

$storeFile = __DIR__ . '/data/store.json';
$authFile = __DIR__ . '/data/auth.json';
$defaultPassword = '12345679987654321';
$maxBodyBytes = 5242880;
$defaultImage = 'assets/hero-store.svg';

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function read_json_file(string $file, array $fallback = []): array
{
    if (!is_file($file)) {
        return $fallback;
    }

    $json = file_get_contents($file);
    $data = json_decode((string) $json, true);
    return is_array($data) ? $data : $fallback;
}

function write_json_file(string $file, array $data): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        respond(['ok' => false, 'error' => 'Invalid data'], 400);
    }

    $tmp = $file . '.tmp';
    if (file_put_contents($tmp, $json, LOCK_EX) === false || !rename($tmp, $file)) {
        @unlink($tmp);
        respond(['ok' => false, 'error' => 'Cannot write data file'], 500);
    }
}

function public_store(array $store): array
{
    if (isset($store['settings']) && is_array($store['settings'])) {
        unset($store['settings']['adminPassword']);
    }
    return $store;
}

function is_direct_image_url(string $url): bool
{
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return false;
    }

    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true)) {
        return false;
    }

    $host = strtolower((string) ($parts['host'] ?? ''));
    $path = (string) ($parts['path'] ?? '');
    $query = isset($parts['query']) ? '?' . $parts['query'] : '';

    if ($host === 'res.cloudinary.com' && str_contains($path, '/upload/')) {
        return true;
    }

    return (bool) preg_match('/\.(svg|png|jpe?g|webp|gif)(\?.*)?$/i', $path . $query);
}

function normalize_image_url($value, string $fallback): string
{
    $url = trim((string) $value);
    if ($url === '' || strlen($url) > 500) {
        return $fallback;
    }

    if (str_starts_with($url, 'assets/')) {
        return preg_match('/^assets\/[A-Za-z0-9._\/-]+\.(svg|png|jpe?g|webp|gif)$/i', $url) ? $url : $fallback;
    }

    if (!is_direct_image_url($url)) {
        return $fallback;
    }

    if (str_contains($url, 'res.cloudinary.com') && str_contains($url, '/upload/')) {
        $normalized = preg_replace('#/upload/(?:[^/]+/)*(?=v\d+/)#', '/upload/f_auto,q_auto,c_limit,w_900/', $url, 1);
        if (is_string($normalized) && $normalized !== $url) {
            return $normalized;
        }
        return str_replace('/upload/', '/upload/f_auto,q_auto,c_limit,w_900/', $url);
    }

    return $url;
}

function normalize_gallery($value, string $fallback): array
{
    $items = is_array($value) ? $value : [];
    return array_values(array_slice(array_filter(array_map(
        fn ($item) => normalize_image_url($item, ''),
        $items
    )), 0, 8));
}

function normalize_store(array $store, string $defaultImage): array
{
    if (isset($store['banner']) && is_array($store['banner'])) {
        $store['banner']['image'] = normalize_image_url($store['banner']['image'] ?? '', $defaultImage);
    }

    if (isset($store['categories']) && is_array($store['categories'])) {
        foreach ($store['categories'] as &$category) {
            if (is_array($category)) {
                $category['image'] = normalize_image_url($category['image'] ?? '', $defaultImage);
            }
        }
        unset($category);
    }

    if (isset($store['products']) && is_array($store['products'])) {
        foreach ($store['products'] as &$product) {
            if (is_array($product)) {
                $product['image'] = normalize_image_url($product['image'] ?? '', $defaultImage);
                $product['gallery'] = normalize_gallery($product['gallery'] ?? [], $defaultImage);
            }
        }
        unset($product);
    }

    return $store;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_same_origin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    $host = $_SERVER['HTTP_HOST'] ?? '';
    $parts = parse_url($origin);
    if (!is_array($parts) || (($parts['host'] ?? '') !== preg_replace('/:\d+$/', '', $host))) {
        respond(['ok' => false, 'error' => 'Invalid origin'], 403);
    }
}

function require_csrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($token === '' || empty($_SESSION['csrf']) || !hash_equals((string) $_SESSION['csrf'], (string) $token)) {
        respond(['ok' => false, 'error' => 'Invalid security token'], 403);
    }
}

function check_login_rate_limit(): void
{
    $now = time();
    $first = (int) ($_SESSION['login_first_attempt'] ?? $now);
    $attempts = (int) ($_SESSION['login_attempts'] ?? 0);

    if ($now - $first > 900) {
        $_SESSION['login_first_attempt'] = $now;
        $_SESSION['login_attempts'] = 0;
        return;
    }

    if ($attempts >= 8) {
        respond(['ok' => false, 'error' => 'Too many login attempts'], 429);
    }
}

function register_failed_login(): void
{
    $_SESSION['login_first_attempt'] = $_SESSION['login_first_attempt'] ?? time();
    $_SESSION['login_attempts'] = ((int) ($_SESSION['login_attempts'] ?? 0)) + 1;
}

function write_auth_file(string $authFile, string $password): void
{
    write_json_file($authFile, [
        'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
        'passwordSha256' => hash('sha256', $password),
    ]);
}

function verify_admin_password(string $authFile, string $defaultPassword, string $password): bool
{
    $auth = read_json_file($authFile);
    if (empty($auth['passwordHash']) && empty($auth['passwordSha256'])) {
        write_auth_file($authFile, $defaultPassword);
        $auth = read_json_file($authFile);
    }

    if (!empty($auth['passwordHash']) && is_string($auth['passwordHash']) && password_verify($password, $auth['passwordHash'])) {
        return true;
    }

    return !empty($auth['passwordSha256'])
        && is_string($auth['passwordSha256'])
        && hash_equals($auth['passwordSha256'], hash('sha256', $password));
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? 'store';

if ($method === 'GET' && $action === 'store') {
    respond(['ok' => true, 'data' => public_store(read_json_file($storeFile))]);
}

if ($method === 'GET' && $action === 'session') {
    $authenticated = !empty($_SESSION['admin']);
    respond([
        'ok' => true,
        'authenticated' => $authenticated,
        'csrfToken' => $authenticated ? csrf_token() : null,
    ]);
}

if ($method !== 'POST') {
    respond(['ok' => false, 'error' => 'Method not allowed'], 405);
}

$body = (string) file_get_contents('php://input', false, null, 0, $maxBodyBytes + 1);
if (strlen($body) > $maxBodyBytes) {
    respond(['ok' => false, 'error' => 'Request body too large'], 413);
}

$input = json_decode($body, true);
$input = is_array($input) ? $input : [];

if ($action === 'login') {
    require_same_origin();
    check_login_rate_limit();
    $password = (string) ($input['password'] ?? '');
    if (verify_admin_password($authFile, $defaultPassword, $password)) {
        session_regenerate_id(true);
        $_SESSION['login_attempts'] = 0;
        $_SESSION['admin'] = true;
        respond(['ok' => true, 'csrfToken' => csrf_token()]);
    }
    register_failed_login();
    respond(['ok' => false, 'error' => 'Invalid password'], 401);
}

if ($action === 'logout') {
    require_csrf();
    $_SESSION = [];
    session_destroy();
    respond(['ok' => true]);
}

if ($action === 'visit') {
    $store = read_json_file($storeFile);
    $store['visits'] = (int) ($store['visits'] ?? 0) + 1;
    write_json_file($storeFile, $store);
    respond(['ok' => true, 'visits' => $store['visits']]);
}

if (empty($_SESSION['admin'])) {
    respond(['ok' => false, 'error' => 'Unauthorized'], 401);
}

require_same_origin();
require_csrf();

if ($action === 'store') {
    $store = $input['data'] ?? null;
    if (!is_array($store)) {
        respond(['ok' => false, 'error' => 'Missing store data'], 400);
    }

    $newPassword = '';
    if (isset($store['settings']) && is_array($store['settings'])) {
        $newPassword = trim((string) ($store['settings']['adminPassword'] ?? ''));
        unset($store['settings']['adminPassword']);
    }

    if ($newPassword !== '') {
        write_auth_file($authFile, $newPassword);
    }

    $store = normalize_store($store, $defaultImage);
    write_json_file($storeFile, public_store($store));
    respond(['ok' => true, 'data' => public_store($store)]);
}

respond(['ok' => false, 'error' => 'Unknown action'], 404);
