"""Integration coverage for the approved forum art import, including real API reads."""
import hashlib
import json
from pathlib import Path

from app.schemas.export_import import ExportData
from app.services import template_loader

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'tools/forum_art_sources.json'


def _imports():
    return json.loads(MANIFEST.read_text())['imports']


def test_approved_forum_assets_preserve_provenance_and_selection_paths():
    template_loader.load_templates()
    assert not template_loader.get_load_errors()
    approvals = json.loads((ROOT / 'tools/forum_art_review_candidates.json').read_text())['cards']
    expected = {c['id']: c for c in approvals}
    records = _imports()
    assert {r['id'] for r in records} == set(expected)
    seen = set()
    for record in records:
        assert record['sha256'] == expected[record['id']]['sha256']
        for output in record['outputs']:
            path = ROOT / output['path']
            assert str(path) not in seen
            seen.add(str(path))
            assert hashlib.sha256(path.read_bytes()).hexdigest() == output['sha256']
            template = template_loader.get_template(output['template'])
            assert template and template.has_image
            resolved = template_loader.get_template_image_path_by_filename(output['template'],path.name)
            assert resolved.resolve() == path.resolve()
            if record['action'] == 'upgrade':
                assert template_loader.get_template_image_path(output['template']).resolve() == path.resolve()
                assert template.images[0] == path.name
            if record['action'] == 'variant_upgrade' and output.get('role') != 'default_if_missing':
                assert template_loader.get_template_image_path(output['template']).name != path.name
            if output['archived_path']:
                old = ROOT / output['archived_path']
                assert hashlib.sha256(old.read_bytes()).hexdigest() == output['archived_sha256']
    # The incorrectly mapped Canadian cover is audit history, not a US choice.
    assert not any('before_forum_img_0306' in name for name in template_loader.get_template('amex/biz_gold').images)


def test_forum_templates_images_and_new_cards_round_trip(client,auth_headers):
    template_loader.load_templates()
    records = _imports()
    for record in records:
        for output in record['outputs']:
            filename = Path(output['path']).name
            response=client.get(f"/api/templates/{output['template']}/image/{filename}",headers=auth_headers)
            assert response.status_code == 200
            assert response.headers['content-type'].startswith('image/')
            assert hashlib.sha256(response.content).hexdigest() == output['sha256']
    profile=client.post('/api/profiles',json={'name':'Forum import validation'},headers=auth_headers)
    assert profile.status_code == 201
    new_ids=sorted({r['proposed_product_key'] for r in records if r['action']=='new_product'})
    assert len(new_ids)==28
    for tid in new_ids:
        t=template_loader.get_template(tid)
        assert t and t.version_id
        response=client.post('/api/cards',json={
            'profile_id':profile.json()['id'],'template_id':tid,'card_name':t.name,
            'issuer':t.issuer,'network':t.network,'annual_fee':t.annual_fee,
            'open_date':'2026-09-09','card_type':'business' if 'business' in (t.tags or []) else 'personal',
            'template_version_id':t.version_id,
        },headers=auth_headers)
        assert response.status_code==201,(tid,response.text)
        card=response.json()
        assert client.get(f"/api/cards/{card['id']}/benefits",headers=auth_headers).status_code==200
        assert client.get(f"/api/cards/{card['id']}/image",headers=auth_headers).status_code==200
    response=client.get('/api/profiles/export',headers=auth_headers)
    assert response.status_code==200
    ExportData.model_validate(response.json())
    imported=client.post('/api/profiles/import?mode=new',json=response.json(),headers=auth_headers)
    assert imported.status_code==200,imported.text
