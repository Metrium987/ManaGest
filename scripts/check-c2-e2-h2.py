"""Vérifie sur la preview déployée les trois écrans fermés ce tour :
C2 (historique des prix fournisseur), E2 (révision de contrat), H2 (masquage
du journal pour un compte sans `products.cost.read`)."""
import json
import urllib.error
import urllib.request
from datetime import date

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
today = date.today().isoformat()

# --- C2 : historique des prix fournisseur -----------------------------------
print('--- C2 : historique des prix fournisseur ---')
status, vendors = raw('GET', '/api/vendors?per_page=5', headers=admin)
vendor = (vendors.get('data') or [{}])[0]
status, products = raw('GET', '/api/products?per_page=10', headers=admin)
product = next((p for p in (products.get('data') or []) if p.get('item_type') != 'service'), None)
check('article et fournisseur disponibles', bool(product and vendor.get('id')), (vendor, product))

if product and vendor.get('id'):
    status, links = raw('GET', f"/api/products/{product['id']}/vendors", headers=admin)
    existing = next((l for l in (links.get('data') or []) if l.get('vendor_id') == vendor['id']), None)
    base_price = int(existing['price']) if existing else 12000
    if not existing:
        # No prior quote: the ledger only has a previous price once one exists,
        # so the check writes the baseline itself before moving the price.
        raw('POST', f"/api/products/{product['id']}/vendors", {
            'vendor_id': vendor['id'],
            'price': base_price,
            'moq': 0,
            'lead_time_days': 3,
            'vendor_ref': 'CTRL-HIST',
            'is_preferred': False,
        }, admin)
    payload = {
        'vendor_id': vendor['id'],
        'price': base_price + 7000,
        'moq': 0,
        'lead_time_days': 3,
        'vendor_ref': 'CTRL-HIST',
        'is_preferred': bool(existing and existing.get('is_preferred')),
    }
    status, saved = raw('POST', f"/api/products/{product['id']}/vendors", payload, admin)
    check('prix fournisseur enregistré', status in (200, 201), saved)

    status, links = raw('GET', f"/api/products/{product['id']}/vendors", headers=admin)
    link = next((l for l in (links.get('data') or []) if l.get('vendor_id') == vendor['id']), {})
    history = link.get('history') or []
    check('l’ancien prix reste dans l’historique',
          any(int(h.get('price', -1)) == base_price for h in history), history)
    check('le prix courant est celui qui vient d’être saisi',
          int(link.get('price', 0)) == base_price + 7000, link.get('price'))
    count = len(history)

    status, saved = raw('POST', f"/api/products/{product['id']}/vendors", payload, admin)
    status, links = raw('GET', f"/api/products/{product['id']}/vendors", headers=admin)
    link = next((l for l in (links.get('data') or []) if l.get('vendor_id') == vendor['id']), {})
    check('même prix réenregistré : aucun mouvement inventé',
          len(link.get('history') or []) == count, link.get('history'))

    payload['price'] = base_price
    raw('POST', f"/api/products/{product['id']}/vendors", payload, admin)
    print(f'  —     prix remis à {base_price} ({product.get("name")} / {vendor.get("name")})')

# --- E2 : révision de contrat ----------------------------------------------
print('--- E2 : révision de tarif d’un contrat ---')
status, contracts = raw('GET', '/api/recurring-invoices?per_page=20', headers=admin)
contract = next((c for c in (contracts.get('data') or []) if c.get('line_items')), None)
check('un contrat avec lignes existe', bool(contract), status)

if contract:
    status, revision = raw('POST', f"/api/recurring-invoices/{contract['id']}/revision",
                           {'percent_bp': 250, 'effective_date': today, 'reason': 'Contrôle E2'}, admin)
    check('révision appliquée -> 201', status == 201, revision)
    check('le total augmente',
          float(revision.get('new_total', 0)) > float(revision.get('old_total', 0)), revision)

    status, history = raw('GET', f"/api/recurring-invoices/{contract['id']}/revisions", headers=admin)
    entry = next((r for r in (history.get('data') or []) if int(r.get('percent_bp', 0)) == 250), None)
    check('la révision figure dans l’historique du contrat', bool(entry), history)
    check('l’historique garde les totaux avant/après',
          bool(entry) and float(entry.get('old_total', 0)) < float(entry.get('new_total', 0)), entry)

    status, bad = raw('POST', f"/api/recurring-invoices/{contract['id']}/revision",
                      {'percent_bp': 0, 'effective_date': today}, admin)
    check('un taux nul est refusé -> 422', status == 422, bad)

# --- H2 : masquage du journal ----------------------------------------------
print('--- H2 : journal masqué sans products.cost.read ---')
status, activity = raw('GET', '/api/activity?per_page=100', headers=admin)
rows = activity.get('data') or []
check('le journal est lisible par l’administrateur', status == 200 and bool(rows), status)


def cost_values(entries):
    """Renvoie (nombre de champs de coût, nombre de valeurs encore numériques)."""
    fields = leaked = 0
    for row in entries:
        for column in ('before_json', 'after_json'):
            raw_json = row.get(column)
            if not raw_json:
                continue
            try:
                parsed = json.loads(raw_json)
            except Exception:
                continue
            if not isinstance(parsed, dict):
                continue
            for key, value in parsed.items():
                if any(word in key.lower() for word in ('price', 'cost', 'margin', 'marge')):
                    fields += 1
                    if value not in ('•••', None):
                        leaked += 1
    return fields, leaked


admin_fields, admin_leaked = cost_values(rows)
check('l’administrateur voit les valeurs de coût', admin_fields == 0 or admin_leaked > 0,
      f'{admin_fields} champs, {admin_leaked} valeurs')

for email in ('comptable@managest.pf', 'commercial@managest.pf'):
    headers = login(email)
    status, other = raw('GET', '/api/activity?per_page=100', headers=headers)
    if status != 200:
        print(f'  —     {email} : journal refusé ({status}), conforme au rôle')
        continue
    fields, leaked = cost_values(other.get('data') or [])
    check(f'{email} : aucun coût en clair', leaked == 0, f'{fields} champs, {leaked} valeurs')

print(f'\n{OK} OK / {FAIL} ECHEC')
raise SystemExit(1 if FAIL else 0)
