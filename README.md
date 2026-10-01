# 8build · Fire Sign Designator

Plan fire exit signage from the drawings before you get to site.

Upload a plan for each building level, mark the final exits to the street, and the designator:

1. **Reads the drawing**: finds walls (thick ink) and ignores annotation (text, dimensions, door swings), works out the building outline, and suggests stairwells from their tread pattern.
2. **Follows the escape routes**: traces the shortest route from every part of every floor to a final exit. Upper floors route down through the stairs you mark, and routes prefer corridors to cutting through rooms.
3. **Places the signs** using the placement rules below, and shows each sign's arrow and plan direction on the drawing.
4. **Counts them** per floor and per direction, matches each sign to a product in your signage catalogue, and exports a branded PDF pack and a CSV sign schedule for site set-up.

## Placement rules applied

| Rule | How the designator applies it |
| --- | --- |
| Decision points | A sign at every change of direction (bend sharper than 35°), corridor junction, level change (stair entry and each landing) and door on the escape route. |
| Line of sight | Extra “straight on” signs so the next sign is never further than the maximum viewing distance. |
| Viewing distance | From the sign height: 100 mm → 17 m, scaling up to a 30 m maximum (set in **Settings**). |
| Mounting | Turn signs go on the wall the person is walking towards (1.7–2.0 m AFF), or are suspended where no wall is near. Exit and door signs go above the door head, never on door leaves. |
| Arrows | ↓ above a final exit door · ↑ straight on / through a door · ← → at turns · ↙ ↖ for stairs. |

Small rooms where the way out is obvious (under 25 m² by default) are not signed. Doors serving more than 60 m² get a sign above them. Both thresholds are adjustable.

## Using it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ – host anywhere (no server needed)
npm test
```

1. **Add drawings**: PDF (one floor per page) or PNG/JPG. Export DWG/DXF to PDF first.
2. **Set the scale**. PDFs assume 1:100 at the printed sheet size; change the ratio, or use **Set scale** to drag along a known dimension. Use **Analysis area** to box the building and leave out the title block.
3. **Mark final exits** (usually ground floor) and **stairs**. Give a stair the same letter on every floor it serves so the floors link up. Dashed “Stair?” boxes are detected stairwells; click one to accept it.
4. **Analyse & place signs**. Fix any misread walls with **Draw wall** / **Erase wall** and run it again. Signs you move or add are kept.
5. **Review**: change a sign's type, mounting, direction or product, and add notes for the site team.
6. **Catalogue**: import your product range as CSV (`code, name, kinds, height_mm, width_mm, mount, material, price, image`) and pick a default product per sign type. Product images are matched by file name = product code.
7. **Export PDF** (summary, one annotated page per floor, full schedule) or **Schedule CSV**. **Save** writes a project file, and the browser also autosaves your last session.

Try **Load example** for a two-storey office with the exit and stair already marked.

## How it works

Everything runs in the browser. The analysis runs in a Web Worker (`src/core`, no DOM dependencies, unit tested in `tests/`):

- `walls.ts` thresholds the drawing and applies a morphological opening sized to the minimum wall thickness. This keeps walls and drops thin linework. A closing that bridges door and window openings gives the building footprint.
- `stairs.ts` finds patches of evenly spaced parallel thin lines (200–380 mm pitch) as stair suggestions.
- `analyze.ts` builds a 100 mm navigation grid. It then runs one multi-floor Dijkstra from all final exits, with stairs linking floors. The cost keeps routes off walls and adds a cost for each doorway. It works out the floor area each cell serves and straightens each route. Signs then go at turns, junctions, doors, stairs and exits, plus extra signs to keep the viewing distance. Duplicates are merged.

## Important

This is a design aid. It produces a proposed layout to speed up site set-up, not a fire strategy. A competent person must check the layout against the building's fire strategy, BS 5499-4, BS ISO 7010 and the Regulatory Reform (Fire Safety) Order before installation. Detection works best on clean, black-line architectural plans. Always check the detected walls layer.

## Brand

Styled with the 8build design system (`src/styles/tokens.css`): ink `#1A1712`, signal red `#E5101B`, paper `#F7F5F0`, Archivo (stand-in for the licensed brand typeface). Replace `public/brand/8build-logo-dark.jpeg` with a vector logo when available. The fire signs themselves use ISO 7010 safety green, as the standards require.
