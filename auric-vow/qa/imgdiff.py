"""Pixel diff of two captures, masking the HUD columns. Prints mean abs error
per channel (0-255), share of pixels differing by more than a threshold, and
writes an amplified diff image."""
import sys
from PIL import Image, ImageChops, ImageStat

a = Image.open(sys.argv[1]).convert('RGB')
b = Image.open(sys.argv[2]).convert('RGB')
out = sys.argv[3]
w, h = a.size
d = ImageChops.difference(a, b)
# mask the HUD: left column panels and right-bottom ammo block
mask = Image.new('L', (w, h), 255)
from PIL import ImageDraw
dr = ImageDraw.Draw(mask)
dr.rectangle([0, 0, int(w * 0.32), int(h * 0.33)], fill=0)
dr.rectangle([0, int(h * 0.70), int(w * 0.26), h], fill=0)
dr.rectangle([int(w * 0.84), int(h * 0.88), w, h], fill=0)
st = ImageStat.Stat(d, mask)
lum = d.convert('L')
hist = lum.histogram(mask)
tot = sum(hist)
over = lambda t: sum(hist[t:]) / tot * 100
print(f'mean abs err RGB = {[round(x, 2) for x in st.mean]}   px >8: {over(8):.2f}%   px >24: {over(24):.2f}%   px >64: {over(64):.2f}%')
amp = lum.point(lambda v: min(255, v * 6))
amp.save(out)
