"""Check the rotary crusher: every printed part is one valid solid and nothing collides\nat any crank angle (15 degree steps).  python check_rotary.py [param=value ...]"""
import sys, itertools
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rotary_crusher as rc
p = dict(rc.P0)
for kv in sys.argv[1:]:
    k, v = kv.split('='); p[k] = float(v)
d = rc.derive(p)
print({k: round(v, 1) for k, v in d.items()}, 'load', rc.load_window(p, d))
for k, s in rc.print_parts(p, d).items():
    v = s.val(); bb = v.BoundingBox()
    print(f"{k:13s} valid={v.isValid()} solids={len(s.solids().vals())} {bb.xlen:.0f}x{bb.ylen:.0f}x{bb.zlen:.0f}")
touch = {frozenset(x) for x in [('platen','wrist_pin'),('conrod','wrist_pin'),('guide_tubes','tie_rods'),('guide_tubes','platen'),('guide_tubes','fixed_jaw'),
 ('guide_tubes','bottom_plate'),('guide_tubes','top_plate'),('tie_rods','fixed_jaw'),('tie_rods','bottom_plate'),('tie_rods','top_plate'),('axle','rotor_lower'),('axle','rotor_upper'),
 ('axle','bottom_plate'),('axle','handle_hub'),('handle','handle_hub'),('handle','knob'),('conrod','rotor_lower'),('rotor_upper','top_plate'),('board','bottom_plate'),('board','fixed_jaw')]}
bad = {}
for th in range(0, 360, 15):
    _, parts = rc.build(p, th)
    names = list(parts)
    for a, b in itertools.combinations(names, 2):
        if frozenset((a, b)) in touch: continue
        sa, sb = parts[a][0].val(), parts[b][0].val()
        A, B = sa.BoundingBox(), sb.BoundingBox()
        if A.xmax < B.xmin or B.xmax < A.xmin or A.ymax < B.ymin or B.ymax < A.ymin or A.zmax < B.zmin or B.zmax < A.zmin: continue
        v = sa.intersect(sb).Volume()
        if v > 2.0: bad.setdefault(f"{a} x {b}", []).append((th, round(v)))
for k, v in bad.items(): print('HIT', k, v[:8])
print('interference pairs:', len(bad))
