#!/usr/bin/env python3
"""Apply the reviewed 2026-09-09 forum approval manifest from a verified local cache.

No network access or card-data edits. Existing image filenames remain stable.
Image transcoding changes file format only; source pixels and dimensions are retained.
Run with --write after reviewing the printed plan. Requires Pillow.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'tools/forum_art_sources.json'
DEFAULTS = {'amex/everyday':'img-0398','amex/everyday_preferred':'img-0404',
            'boa/flying_blue':'img-0608','brex/corporate':'img-0301',
            'chase/freedom':'img-0006','chase/ihg_select':'img-0273',
            'stanfordfcu/alumni_rewards':'img-0605'}
SUPPLEMENTARY = {'img-0405':['amex/platinum'],
                 'img-0249':['amex/biz_platinum','amex/biz_gold']}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('approval',type=Path)
    p.add_argument('--cache',type=Path,default=ROOT/'work/forum-art-review/source/images-indexed.json')
    p.add_argument('--write',action='store_true')
    args=p.parse_args()
    approved=json.loads(args.approval.read_text())
    canonical=json.loads((ROOT/'tools/forum_art_review_candidates.json').read_text())
    assert approved['review_id']==canonical['review_id']
    known={c['id']:c for c in canonical['cards']}
    assets={a['id']:a for a in json.loads(args.cache.read_text())}
    prior=json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {'review_id':approved['review_id'],'imports':[]}
    done={r['id']:r for r in prior['imports']}
    ids=[a['id'] for a in approved['accept']]
    assert len(ids)==len(set(ids)), 'Duplicate approval IDs'
    plans=[]
    for selected in approved['accept']:
        c=known[selected['id']]
        for field in ['sha256','source_url','template','action','replace_path','proposed_product_key']:
            assert selected.get(field)==c.get(field), f"Unreviewed {field} for {c['id']}"
        source=ROOT/assets[c['id']]['path']
        assert source.is_file() and sha(source)==c['sha256'], f"Source checksum mismatch: {c['id']}"
        if c['id'] in done:
            for dest in done[c['id']]['outputs']:
                assert sha(ROOT/dest['path'])==dest['sha256'],f"Imported file changed: {dest['path']}"
            continue
        targets=SUPPLEMENTARY.get(c['id']) or [c['template'] or c['proposed_product_key']]
        for target in targets:
            carddir=ROOT/'card_templates'/target
            assert carddir.resolve().is_relative_to(ROOT/'card_templates')
            if c['action'] in ('upgrade','variant_upgrade'):
                dest=ROOT/c['replace_path']
                assert dest.parent==carddir and dest.is_file()
            elif c['action']=='new_product' and c['id']==DEFAULTS.get(target,c['id']):
                dest=carddir/'card.png'
            else:
                label='companion_platinum' if c['id']=='img-0405' else 'employee_business_expense' if c['id']=='img-0249' else 'forum'
                dest=carddir/f"{label}_{c['id'].replace('-','_')}.png"
            assert not dest.exists() or c['action'] in ('upgrade','variant_upgrade'),str(dest)
            plans.append((c,source,dest,target))
    assert len({str(plan[2]) for plan in plans})==len(plans),'Conflicting image destinations'
    print(f'{len(ids)} approved assets; {len(plans)} pending image writes')
    if not args.write:
        for c,_,dest,_ in plans:print(c['id'],c['action'],dest.relative_to(ROOT))
        return
    for c,source,dest,target in plans:
        dest.parent.mkdir(parents=True,exist_ok=True)
        archived=None
        if dest.exists():
            # Incorrect Canadian art is retained for audit, not as a US-selectable cover.
            history='.art-history' if c['id']=='img-0306' else 'old'
            archived=dest.parent/history/f"before_forum_{c['id'].replace('-','_')}{dest.suffix}"
            archived.parent.mkdir(exist_ok=True)
            if archived.exists():assert sha(archived)==sha(dest),'Archive collision'
            else:shutil.copy2(dest,archived)
        with Image.open(source) as original:
            original.load()
            # No invented detail, resizing, cropping, redaction, or generative editing.
            if dest.suffix.lower() in ('.jpg','.jpeg'):
                if original.format=='JPEG':shutil.copyfile(source,dest)
                else:original.convert('RGB').save(dest,format='JPEG',quality=100,subsampling=0)
            else:original.save(dest,format='PNG',optimize=True)
        record=done.setdefault(c['id'],{**{k:v for k,v in c.items() if k not in ('image','existing_image')},'outputs':[]})
        record['outputs'].append({'template':target,'path':str(dest.relative_to(ROOT)),
            'sha256':sha(dest),'source_dimensions':[c['width'],c['height']],
            'archived_path':str(archived.relative_to(ROOT)) if archived else None,
            'archived_sha256':sha(archived) if archived else None})
    # A legacy template may have only named artwork and no default at all.
    # Seed a default from its approved cover so normal API/UI rendering works.
    for record in done.values():
        for output in list(record['outputs']):
            carddir=ROOT/'card_templates'/output['template']
            if any((carddir/f'card{ext}').exists() for ext in ('.png','.jpg','.jpeg','.webp')):continue
            dest=carddir/'card.png'
            with Image.open(ROOT/output['path']) as im:im.save(dest,format='PNG',optimize=True)
            record['outputs'].append({'template':output['template'],'path':str(dest.relative_to(ROOT)),
                'sha256':sha(dest),'source_dimensions':output['source_dimensions'],
                'archived_path':None,'archived_sha256':None,'role':'default_if_missing'})
    prior['imports']=[done[i] for i in sorted(done)]
    REGISTRY.write_text(json.dumps(prior,indent=2,ensure_ascii=False)+'\n')
    print(f"Recorded {len(done)} assets in {REGISTRY.relative_to(ROOT)}")

if __name__=='__main__':main()
