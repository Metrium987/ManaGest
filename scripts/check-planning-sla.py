"""Contrôle hébergé de la planification et des SLA (G2/G3).

Vérifie sur la preview déployée que :
- l'écran SLA trouve des paliers standard même sur une base neuve ;
- un palier modifié n'est pas écrasé par un nouveau seed et n'est pas dupliqué ;
- appliquer une politique persiste la politique et les échéances sur la tâche,
  et que l'engagement se relit après rechargement (GET dédié + liste).
"""
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
print('--- G3 : paliers standard et application persistée ---')

status, listing = raw('GET', '/api/planning/sla-policies', headers=admin)
policies = listing.get('data') or []
defaults = [policy for policy in policies if policy.get('scope') == 'default']
check('l’écran SLA trouve des paliers standard', status == 200 and len(defaults) >= 3, listing)
check('les priorités P1/P2/P3 existent',
      {'P1', 'P2', 'P3'}.issubset({policy.get('priority') for policy in defaults}), defaults)

p1 = next((policy for policy in defaults if policy.get('priority') == 'P1'), None)
if p1:
    check('le palier P1 est actif', Number(p1.get('is_active')) == 1, p1)
    original = int(p1['resolution_minutes'])
    status, updated = raw('PUT', f"/api/planning/sla-policies/{p1['id']}", {'resolution_minutes': original + 30}, admin)
    check('un palier est modifiable -> 200', status == 200, updated)

    status, again = raw('GET', '/api/planning/sla-policies', headers=admin)
    rows = again.get('data') or []
    edited = next((policy for policy in rows if policy.get('id') == p1['id']), {})
    check('la valeur saisie est conservée', int(edited.get('resolution_minutes', 0)) == original + 30, edited)
    check('aucun doublon créé par le seed',
          len([policy for policy in rows if policy.get('scope') == 'default']) == len(defaults),
          len(rows))

    status, tasks = raw('GET', '/api/tasks?per_page=20', headers=admin)
    task = (tasks.get('data') or [{}])[0]
    check('une tâche existe', bool(task.get('id')))
    if task.get('id'):
        status, applied = raw('POST', f"/api/planning/tasks/{task['id']}/sla", {'priority': 'P1'}, admin)
        check('politique appliquée -> 201', status == 201, applied)
        check('la politique retenue est renvoyée', applied.get('policy_id') == p1['id'], applied)
        check('les échéances sont calculées', bool(applied.get('response_due') and applied.get('resolution_due')), applied)

        status, stored = raw('GET', f"/api/planning/tasks/{task['id']}/sla", headers=admin)
        check('l’engagement se relit après rechargement', status == 200
              and stored.get('policy_id') == p1['id']
              and stored.get('resolution_due') == applied.get('resolution_due'), stored)

        status, all_sla = raw('GET', '/api/planning/sla-assignments', headers=admin)
        row = next((entry for entry in (all_sla.get('data') or []) if entry.get('task_id') == task['id']), None)
        check('l’engagement apparaît dans la liste', bool(row), all_sla)
        check('le badge de dépassement est exposé',
              row is not None and 'response_overdue' in row and 'resolution_overdue' in row, row)

    status, restored = raw('PUT', f"/api/planning/sla-policies/{p1['id']}", {'resolution_minutes': original}, admin)
    check('valeur de départ restaurée', status == 200, restored)

print(f'\n{OK} OK / {FAIL} ECHEC')
raise SystemExit(1 if FAIL else 0)
