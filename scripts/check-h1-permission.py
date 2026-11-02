"""Vérifie sur la preview que le droit d'ajuster le stock est séparé de l'écriture
de la fiche article (H1) : le vendeur est refusé, l'administrateur passe, et le
drapeau est bien distribué aux rôles qui pouvaient déjà le faire."""
import json
import urllib.error
import urllib.request

BASE = 'https://site-c578992b6feb4d56ac337293d766de8a.freebuff.page'
OK = FAIL = 0


def check(label, condition, info=''):
    global OK, FAIL
    if condition:
        OK += 1
        print(f'  OK    {label}')
    else:
        FAIL += 1
        print(f'  ECHEC {label} -> {str(info)[:400]}')


def loads(payload):
    if not payload:
        return None
    try:
        return json.loads(payload)
    except Exception:
        return {'raw': payload[:300]}


def raw(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', BASE)
    req.add_header('User-Agent', 'curl/8.5.0')
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, loads(response.read().decode())
    except urllib.error.HTTPError as error:
        return error.code, loads(error.read().decode())


def login(email):
    req = urllib.request.Request(
        BASE + '/api/auth/login',
        data=json.dumps({'email': email, 'password': email}).encode(),
        method='POST',
    )
    req.add_header('Content-Type', 'application/json')
    req.add_header('Origin', BASE)
    req.add_header('User-Agent', 'curl/8.5.0')
    with urllib.request.urlopen(req) as response:
        response.read()
        cookies = response.headers.get_all('Set-Cookie') or []
    values = {c.split(';')[0].split('=', 1)[0]: c.split(';')[0].split('=', 1)[1] for c in cookies}
    return {
        'Cookie': f"mg_session={values.get('mg_session', '')}; mg_csrf={values.get('mg_csrf', '')}",
        'x-csrf-token': values.get('mg_csrf', ''),
    }


admin = login('admin@managest.pf')
print('--- H1 : stock.adjust séparé de products.write ---')

status, me = raw('GET', '/api/auth/me', headers=admin)
permissions = me.get('permissions') or []
check('l’administrateur détient stock.adjust', 'stock.adjust' in permissions, permissions[-6:])
check('et conserve products.write', 'products.write' in permissions)

status, products = raw('GET', '/api/products?per_page=10', headers=admin)
product = next((p for p in (products.get('data') or []) if p.get('item_type') != 'service' and p.get('track_quantity')), None)
check('un article suivi existe', bool(product))

if product:
    status, adjusted = raw('POST', f"/api/products/{product['id']}/adjust-stock", {'delta': 1, 'reason': 'Contrôle H1'}, admin)
    check('l’administrateur ajuste le stock -> 200', status == 200, adjusted)
    if status == 200:
        raw('POST', f"/api/products/{product['id']}/adjust-stock", {'delta': -1, 'reason': 'Contrôle H1 (retour)'}, admin)

    sales = login('commercial@managest.pf')
    status, me_sales = raw('GET', '/api/auth/me', headers=sales)
    sales_permissions = me_sales.get('permissions') or []
    check('le vendeur n’a pas stock.adjust', 'stock.adjust' not in sales_permissions)
    check('le vendeur n’a pas products.write', 'products.write' not in sales_permissions)

    status, refused = raw('POST', f"/api/products/{product['id']}/adjust-stock", {'delta': 1, 'reason': 'Contrôle H1'}, sales)
    check('le vendeur est refusé sur l’ajustement -> 403', status == 403, refused)
    status, refused = raw('POST', f"/api/products/{product['id']}/transfer",
                          {'from_location': 'A', 'to_location': 'B', 'quantity': 1}, sales)
    check('le vendeur est refusé sur un transfert -> 403', status == 403, refused)

    viewer = login('client@managest.pf')
    status, refused = raw('POST', f"/api/products/{product['id']}/adjust-stock", {'delta': 1}, viewer)
    check('le compte client est refusé -> 403 ou 401', status in (401, 403), refused)

print(f'\n{OK} OK / {FAIL} ECHEC')
raise SystemExit(1 if FAIL else 0)
