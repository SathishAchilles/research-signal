def h(x): x=x.lstrip('#'); return tuple(int(x[i:i+2],16) for i in (0,2,4))
def hx(c): return '#%02X%02X%02X'%tuple(round(v) for v in c)
def lin(v):
    v/=255; return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def L(c): r,g,b=[lin(v) for v in c]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    la,lb=L(h(a)),L(h(b)); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def over(fg,a,bg):
    f,b=h(fg),h(bg); return hx(tuple(a*f[i]+(1-a)*b[i] for i in range(3)))
BRIGHT='#1E6B6E'   # aurora peak behind helix
PART='#3FE0D0'     # helix particle core (worst under nav when scrolled)
CANVAS='#050D10'
surf={}
surf['glass(.62 over aurora peak)']=over('#06181E',.62,BRIGHT)
surf['glass-nav(.72 over particle)']=over('#06181E',.72,PART)
surf['glass-elev(.78 over aurora peak)']=over('#081E24',.78,BRIGHT)
surf['plate(.92 over aurora peak)']=over('#0C1A1F',.92,BRIGHT)
surf['plate(.92 over particle)']=over('#0C1A1F',.92,PART)
surf['plate-hover #12272C']='#12272C'
surf['canvas']=CANVAS
for k,v in surf.items(): print(k,v)
fgs={'text':'#E6F4F3','text-muted':'#9DB8BC','micro':'#7FD9DD','accent':'#3FE0D0','accent-2':'#3FB8BD','rule':'#4FA3A8','chip-border':'#5E9EA3',
'CLIENT':'#FF8A50','READ':'#56B4E9','SKIP':'#A7AEB8','rising':'#3DDC97','focus':'#7FDBFF','CLIENTbar':'#FF8A50','destructive':'#FF6B6B',
'old READ':'#0072B2','old CLIENT':'#D55E00'}
print()
print('fg'.ljust(12),*[k[:14].ljust(15) for k in surf])
for n,f in fgs.items():
    print(n.ljust(12),*[('%.2f'%cr(f,v)).ljust(15) for v in surf.values()])
print('focus vs ring gap canvas', cr('#7FDBFF','#050D10'))
print('accent on plate-solid #0C1A1F', cr('#3FE0D0','#0C1A1F'))
print('solid fallback #0F2227 text', cr('#E6F4F3','#0F2227'), 'muted', cr('#9DB8BC','#0F2227'), 'READ', cr('#56B4E9','#0F2227'),'CLIENT',cr('#FF8A50','#0F2227'))
print('teal submit text #04201E on #3FE0D0', cr('#04201E','#3FE0D0'))
print()
for a in (.78,.80,.82,.85):
    s=over('#06181E',a,PART); print('nav a',a,s,'text %.2f muted %.2f micro %.2f accent %.2f rim-chip %.2f focus %.2f'%(cr('#E6F4F3',s),cr('#9DB8BC',s),cr('#7FD9DD',s),cr('#3FE0D0',s),cr('#5E9EA3',s),cr('#7FDBFF',s)))
pl=over('#0C1A1F',.92,PART)
d=over('#FF6B6B',.10,pl); print('destructive/10 on plate-worst',d,'%.2f'%cr('#FF6B6B',d))
d2=over('#FF6B6B',.12,'#0D2025'); print('destructive/12 on plate-peak',d2,'%.2f'%cr('#FF6B6B',d2))
# chip fill: white .06 over plate
cf=over('#7FE0E6',.08,pl); print('chip fill .08 over plate',cf,'text %.2f muted %.2f border %.2f CLIENT %.2f READ %.2f'%(cr('#E6F4F3',cf),cr('#9DB8BC',cf),cr('#5E9EA3',cf),cr('#FF8A50',cf),cr('#56B4E9',cf)))
# accent button text
print('accent btn fg #03201D on accent %.2f'%cr('#03201D','#3FE0D0'))
# chip border vs plate peak
print('rim rgba(127,224,230,.22) over plate', over('#7FE0E6',.22,'#0D2025'), '%.2f'%cr(over('#7FE0E6',.22,'#0D2025'),'#0D2025'))
print('READ bar #56B4E9 vs plate worst %.2f, CLIENT bar %.2f, SKIP %.2f'%(cr('#56B4E9',pl),cr('#FF8A50',pl),cr('#A7AEB8',pl)))
print('forced: n/a')
print('helix strand #3FB8BD on canvas %.2f'%cr('#3FB8BD','#050D10'))
print('glass-elev solid fallback #0F2227 vs focus %.2f'%cr('#7FDBFF','#0F2227'))
print('muted on glass(.62 peak) %.2f, on elev %.2f'%(cr('#9DB8BC','#0F383C'),cr('#9DB8BC','#0D2F34')))
