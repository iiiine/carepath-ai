import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from conftest import connection


def hospital(code, lat=22.99, lng=120.21, address='臺南市北區測試路1號'):
    return {'hospital_code': code, 'name': f'測試院所{code}', 'address': address,
            'phone': '06-0000000', 'latitude': lat, 'longitude': lng,
            'booking_url': None, 'departments': ['家醫科'], 'opening_sessions': None}


@pytest.mark.parametrize('extra', [
    {'user_latitude': 22.99}, {'user_longitude': 120.21},
    {'user_latitude': 91, 'user_longitude': 120}, {'user_latitude': 23, 'user_longitude': -181},
    {'user_city': '不存在市'}, {'user_city': '臺南市', 'user_latitude': 23, 'user_longitude': 120},
])
def test_diagnose_rejects_invalid_location_before_ai(client, member, diagnosis_setup, extra):
    response = client.post('/api/v1/diagnose', json={'symptom_text': '測試症狀', **extra})
    assert response.status_code == 422
    diagnosis_setup.ai.assert_not_called()
    diagnosis_setup.module.get_db_connection.assert_not_called()


@pytest.mark.parametrize('query', ['lat=23', 'lng=120', 'lat=nan&lng=120', 'lat=90&lng=181', 'city=不存在市', 'city=臺南市&lat=23&lng=120'])
@pytest.mark.parametrize('path', ['/api/v1/hospitals', '/api/v1/emergency-resources'])
def test_resource_query_rejects_invalid_location(client, member, monkeypatch, query, path):
    from routes import hospitals
    db = MagicMock(side_effect=AssertionError('must not read DB'))
    monkeypatch.setattr(hospitals, 'get_db_connection', db)
    assert client.get(f'{path}?{query}').status_code == 422
    db.assert_not_called()


@pytest.mark.parametrize('selection', [{}, {'user_city': '台南市'}, {'user_latitude': 22.99, 'user_longitude': 120.21}])
def test_diagnose_unknown_distances_and_city_filter(client, member, diagnosis_setup, selection):
    cursor = diagnosis_setup.resources.cursor.return_value.__enter__.return_value
    cursor.fetchall.side_effect = [[hospital('B'), hospital('A', None, None), hospital('C', address='臺北市中正區測試路')], []]
    response = client.post('/api/v1/diagnose', json={'symptom_text': '測試症狀', **selection})
    assert response.status_code == 200, response.text
    data = response.json()
    resources = data['nearby_medical_resources']
    missing = next(h for h in resources if h['hospital_code'] == 'A')
    assert missing['distance_meters'] is None
    assert missing['distance_reference'] is None
    assert '目前沒有符合科別的醫師名單' in data['message']
    assert '附近院所與醫師' not in data['message']
    if 'user_city' in selection:
        assert {h['hospital_code'] for h in resources} == {'A', 'B'}
        assert data['location_context'] == {'source': 'city', 'city': '臺南市'}
    if 'user_latitude' in selection:
        assert resources[0]['hospital_code'] == 'B'
        assert resources[0]['distance_meters'] == 0
        assert resources[0]['distance_reference'] == 'provided_coordinates'
        assert resources[-1]['hospital_code'] == 'A'
    else:
        assert all(h['distance_meters'] is None for h in resources)
        assert '不提供附近距離' in data['message']


def test_no_location_does_not_truncate_candidates_before_specialty_sort(client, member, diagnosis_setup):
    rows = [hospital(f'H{i:02}') for i in range(12)]
    cur = diagnosis_setup.resources.cursor.return_value.__enter__.return_value
    cur.fetchall.side_effect = [rows, [{'hospital_code': 'H11', 'name': '測試醫師', 'department': '家醫科', 'specialty': '鼻塞'}]]
    diagnosis_setup.ai.return_value.text = json.dumps({'is_complete': True, 'department': '家醫科', 'causes': ['鼻塞']})
    response = client.post('/api/v1/diagnose', json={'symptom_text': '測試症狀'})
    assert response.status_code == 200, response.text
    assert response.json()['nearby_medical_resources'][0]['hospital_code'] == 'H11'
    assert '有提供醫師名單的院所會一併列出' in response.json()['message']


def test_empty_city_match_does_not_claim_nearby_hospitals(client, member, diagnosis_setup):
    cur = diagnosis_setup.resources.cursor.return_value.__enter__.return_value
    cur.fetchall.side_effect = [[hospital('A')], []]
    response = client.post('/api/v1/diagnose', json={'symptom_text': '測試', 'user_city': '臺北市'})
    assert response.status_code == 200
    assert response.json()['nearby_medical_resources'] == []
    assert '目前查無臺北市的符合科別的院所資料' in response.json()['message']


@pytest.mark.parametrize('query', ['', '?city=台南市', '?lat=0&lng=0'])
def test_hospital_list_keeps_missing_coordinates_and_accepts_zero(client, member, monkeypatch, query):
    from routes import hospitals
    conn, cur = connection(many=[
        {'hospital_code': 'A', 'name': '缺座標', 'address': '臺南市北區', 'lat': None, 'lng': None},
        {'hospital_code': 'B', 'name': '零座標測試', 'address': '臺北市北區', 'lat': 0, 'lng': 0},
    ])
    monkeypatch.setattr(hospitals, 'get_db_connection', lambda: conn)
    response = client.get('/api/v1/hospitals'+query)
    assert response.status_code == 200
    data = response.json()['hospitals']
    assert any(h['hospital_code'] == 'A' and h['distance_meters'] is None for h in data)
    if 'city=' in query:
        assert len(data) == 1
    elif 'lat=' in query:
        assert data[0]['hospital_code'] == 'B' and data[0]['distance_meters'] == 0
    else:
        assert all(h['distance_meters'] is None for h in data)


@pytest.fixture
def emergency_snapshot(app, monkeypatch, tmp_path):
    import emergency_resources
    path = tmp_path/'directory.json'
    source = {
        'review_after': '2026-12-15', 'source_url': 'https://dep.mohw.gov.tw/DOMA/fp-979-4112-106.html',
        'source_updated_on': '2026-02-24', 'verified_on': '2026-09-16', 'coverage': '部分名單',
        'hospitals': [dict(hospital('VERIFIED'), city='臺南市')],
    }
    path.write_text(json.dumps(source))
    monkeypatch.setattr(emergency_resources, 'DIRECTORY_PATH', path)
    monkeypatch.setattr(emergency_resources, 'datetime', SimpleNamespace(now=lambda _: datetime(2026, 9, 16)))
    return path, source


@pytest.mark.parametrize('query,status', [
    ('', 'location_required'), ('?city=臺南市', 'available'), ('?city=臺北市', 'no_verified_match'),
    ('?lat=22.99&lng=120.21', 'available'), ('?lat=0&lng=0', 'no_verified_match'),
])
def test_emergency_lookup_is_independent_of_database(client, member, monkeypatch, emergency_snapshot, query, status):
    from routes import hospitals
    monkeypatch.setattr(hospitals, 'get_db_connection', MagicMock(side_effect=RuntimeError('DB down')))
    response = client.get('/api/v1/emergency-resources'+query)
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == status
    if status == 'available':
        assert len(data['hospitals']) == 1
        assert data['hospitals'][0]['distance_meters'] == (0 if 'lat=' in query else None)
    hospitals.get_db_connection.assert_not_called()


@pytest.mark.parametrize('failure', ['missing', 'invalid', 'invalid_date', 'expired'])
def test_emergency_directory_failure_is_explicit(client, member, emergency_snapshot, failure):
    path, source = emergency_snapshot
    if failure == 'missing': path.unlink()
    elif failure == 'invalid': path.write_text('not json')
    else:
        source['review_after'] = 'not-a-date' if failure == 'invalid_date' else '2026-09-15'
        path.write_text(json.dumps(source))
    response = client.get('/api/v1/emergency-resources?city=臺南市')
    assert response.status_code == 200
    assert response.json()['hospitals'] == []
    assert response.json()['status'] == ('needs_review' if failure == 'expired' else 'unavailable')
    assert response.json()['official_directory_url'].startswith('https://dep.mohw.gov.tw/')


def test_legacy_hospital_response_accepts_nullable_distance(app):
    from models import HospitalResponse
    data = hospital('A', None, None)
    assert HospitalResponse(**data).distance_meters is None
