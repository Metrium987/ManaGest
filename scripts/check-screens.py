import json, time, urllib.request, urllib.error
from datetime import date, timedelta

BASE = 'https://site-c578992b6feb4d56ac337293d766de8a.freebuff.page'
ok = fail = 0
sfx = str(int(time.time()))[-5:]
today = date.today().isoformat()

def check(label, condition, info=''):
    global ok, fail
    if condition: ok += 1; print(f'  OK    {label}')
    else: fail += 1; print(f'  ECHEC {label} -> {str(info)[:300]}')

def loads(p):
    if not p: return None
    try: return json.loads(p)
    except Exception: return {'raw': p[:200]}

def raw(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json'); req.add_header('Origin', BASE); req.add_header('User-Agent', 'curl/8.5.0')
    for k, v in (headers or {}).items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r: return r.status, loads(r.read().decode())
    except urllib.error.HTTPError as e: return e.code, loads(e.read().decode())

def login(email):
    req = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({'email': email, 'password': email}).encode(), method='POST')
    req.add_header('Content-Type', 'application/json'); req.add_header('Origin', BASE); req.add_header('User-Agent', 'curl/8.5.0')
    with urllib.request.urlopen(req) as r:
        r.read(); cookies = r.headers.get_all('Set-Cookie') or []
    vals = {c.split(';')[0].split('=', 1)[0]: c.split(';')[0].split('=', 1)[1] for c in cookies}
    return {'Cookie': f"mg_session={vals.get('mg_session','')}; mg_csrf={vals.get('mg_csrf','')}", 'x-csrf-token': vals.get('mg_csrf','')}

admin = login('admin@managest.pf')
code = 'CHK' + sfx
status, clients = raw('GET', '/api/clients?per_page=1', headers=admin)
client = (clients.get('data') or [{}])[0]
check('client de démonstration disponible', bool(client.get('id')), client)

print('--- rapport par centre de profit : avoirs déduits ---')
raw('PUT', f'/api/profit-centers/{code}', {'name': 'Centre ' + sfx}, admin)
status, invoice = raw('POST', '/api/invoices', {
    'client_id': client['id'], 'date': today, 'due_date': (date.today() + timedelta(days=30)).isoformat(),
    'line_items': [{'id': 'p1', 'description': 'Prestation centre', 'quantity': 1,
                    'unit_price': 100000, 'tax_rate': 16, 'profit_center': code}],
}, admin)
check('facture émise avec un centre', status == 201, invoice)
if invoice.get('id'):
    raw('POST', f"/api/invoices/{invoice['id']}/send", headers=admin)
start = (date.today() - timedelta(days=2)).isoformat()
end = (date.today() + timedelta(days=2)).isoformat()
status, before = raw('GET', f'/api/profit-centers/summary?from={start}&to={end}', headers=admin)
row_before = next((r for r in (before.get('data') or []) if r.get('code') == code), {})
check('centre présent avant l’avoir (base 100 000)', row_before.get('base') == 100000, row_before)

status, credit = raw('POST', '/api/credits', {
    'client_id': client['id'], 'date': today,
    'line_items': [{'id': 'c1', 'description': 'Geste commercial', 'quantity': 1,
                    'unit_price': 30000, 'tax_rate': 16, 'profit_center': code}],
}, admin)
check('avoir créé', status == 201, credit)
if credit.get('id'):
    status, sent = raw('POST', f"/api/credits/{credit['id']}/send", headers=admin)
    check('avoir émis', status == 200, sent)

status, after = raw('GET', f'/api/profit-centers/summary?from={start}&to={end}', headers=admin)
row_after = next((r for r in (after.get('data') or []) if r.get('code') == code), {})
check('base déduite de l’avoir (100 000 → 70 000)', row_after.get('base') == 70000, row_after)
check('TVA déduite (16 000 → 11 200)', row_after.get('tax') == 11200, row_after)
check('total déduit (116 000 → 81 200)', row_after.get('total') == 81200, row_after)
totals = after.get('totals') or {}
check('le rapport compte les avoirs', (totals.get('credits') or 0) >= 1, totals)
check('total du rapport inférieur au total facturé', totals.get('total', 0) < ((before.get('totals') or {}).get('total', 0) + 116000), totals)

print('--- tarif douanier : enregistrement depuis les paramètres ---')
status, before_rules = raw('GET', '/api/import-taxes', headers=admin)
stat = next((r for r in (before_rules.get('rules') or []) if r.get('code') == 'STAT'), {})
status, saved = raw('PUT', '/api/import-taxes/rules/STAT', {
    'label': stat.get('label'), 'base': stat.get('base'), 'rate_bp': stat.get('rate_bp'),
    'amount': 55, 'transport': stat.get('transport'), 'sort_order': stat.get('sort_order'),
    'is_active': True, 'source': stat.get('source'),
}, admin)
check('règle de taxe enregistrée (50 → 55)', status == 200, saved)
status, rules = raw('GET', '/api/import-taxes', headers=admin)
stat2 = next((r for r in (rules.get('rules') or []) if r.get('code') == 'STAT'), {})
check('nouvelle valeur relue', stat2.get('amount') == 55, stat2.get('amount'))
raw('PUT', '/api/import-taxes/rules/STAT', {
    'label': stat.get('label'), 'base': stat.get('base'), 'rate_bp': stat.get('rate_bp'),
    'amount': 50, 'transport': stat.get('transport'), 'sort_order': stat.get('sort_order'),
    'is_active': True, 'source': stat.get('source'),
}, admin)

heading = '84719' + sfx[:3]
status, saved_heading = raw('PUT', f'/api/import-taxes/tariffs/{heading}', {
    'label': 'Position contrôle ' + sfx, 'duty_rate_bp': 1300, 'duty_rate_eu_bp': 0,
    'vat_rate_bp': 1600, 'is_active': True, 'source': 'contrôle écran',
}, admin)
check('position tarifaire enregistrée', status == 200, saved_heading)
status, rules = raw('GET', '/api/import-taxes', headers=admin)
row = next((t for t in (rules.get('tariffs') or []) if t.get('code') == heading), {})
check('position relue avec ses taux', row.get('duty_rate_bp') == 1300 and row.get('duty_rate_eu_bp') == 0, row)

print('--- transfert de lot depuis la fiche article ---')
status, product = raw('POST', '/api/products', {
    'name': 'Lot écran ' + sfx, 'item_type': 'stockable', 'unit_price': 5000, 'purchase_price': 2000,
    'track_quantity': True, 'lot_tracking': 'lot', 'warehouse_location': 'ENTREPOT',
}, admin)
pid = (product or {}).get('id')
check('article suivi par lot créé', bool(pid), product)
if pid:
    status, lot = raw('POST', f'/api/products/{pid}/lots', {'lot_code': 'ECRAN-' + sfx, 'quantity': 8, 'location': 'ENTREPOT'}, admin)
    check('lot réceptionné', status == 201, lot)
    status, lots = raw('GET', f'/api/products/{pid}/lots', headers=admin)
    check('lot proposé dans la liste de la modale', any(l.get('lot_code') == 'ECRAN-' + sfx for l in (lots.get('data') or [])), lots)
    status, moved = raw('POST', f"/api/products/{pid}/lots/{(lot or {}).get('id')}/transfer", {'to_location': 'BOUTIQUE', 'quantity': 3}, admin)
    check('transfert exécuté', status == 200, moved)
    status, balances = raw('GET', f'/api/products/{pid}/lots/balances', headers=admin)
    rows = {r.get('location'): r.get('quantity') for r in (balances.get('data') or [])}
    check('soldes affichés : ENTREPOT 5 / BOUTIQUE 3', rows.get('ENTREPOT') == 5 and rows.get('BOUTIQUE') == 3, rows)

print('--- remise à zéro de la démonstration depuis les paramètres ---')
raw('PUT', '/api/demo/mode', {'enabled': True}, admin)
status, reset = raw('POST', '/api/demo/reset', {'reseed': True}, admin)
check('reset exécuté', status == 200, reset)
check('tables transactionnelles vidées', (len(reset.get('cleared') or []) > 10), len(reset.get('cleared') or []))
check('aucune table ignorée', reset.get('skipped') == [], reset.get('skipped'))
check('jeu de démonstration réinstallé', reset.get('reseeded') is True, reset)
status, clients_after = raw('GET', '/api/clients?per_page=100', headers=admin)
check('clients de démonstration présents après reset', len(clients_after.get('data') or []) == 5, len(clients_after.get('data') or []))
status, demo = raw('GET', '/api/demo', headers=admin)
check('drapeau démo allumé (bouton visible)', demo.get('demo_mode') is True, demo)
status, journal = raw('GET', '/api/activity?per_page=20', headers=admin)
entries = (journal.get('data') or journal.get('entries') or []) if isinstance(journal, dict) else []
check('journal : reset tracé', any(e.get('summary') == 'activity.demo_reset' for e in entries), [e.get('summary') for e in entries][:6])

print(f'\n{ok} OK / {fail} ECHEC')
