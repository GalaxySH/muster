/**
 * Test-only fixture: one synthetic W2W week in the observed export dialect.
 * Dated rows, numeric day-of-week, quoted names, an unmapped position, a dock
 * row sharing the stocker block, a description-only special row, and a stale
 * assignment. Shared by the round-trip test and the run-building tests so both
 * are judged against the same awkward week; nothing in the app imports it.
 */
import type { MatchBlock, W2wPositionMapEntry } from "./types";

const HEADER =
  '"Shift ID","Schedule ID","Employee Number","Position ID","Position Name","Category","Shift Description","Date","Start Time","End Time","Duration","Day Of Week","Employee Name"';

export const PLAN_SOURCE = [
  HEADER,
  '1,9,,100,"GDEC - CA",,,12/20/2026,08:00 AM,11:00 AM,   3.0,0,',
  '2,9,,100,"GDEC - CA",,,12/20/2026,08:00 AM,11:00 AM,   3.0,0,"Gone, Person"',
  '3,9,,100,"GDEC - CA",,,12/21/2026,08:00 AM,11:00 AM,   3.0,1,',
  '4,9,,200,"GDEC - Stocker",,,12/21/2026,07:00 AM,10:30 AM,   3.5,1,',
  '5,9,,201,"GDEC - Dock Stocker",,,12/21/2026,07:00 AM,10:30 AM,   3.5,1,',
  '6,9,,300,"GDEC - SL",,"SHIFT LEAD MEETING",12/20/2026,10:00 AM,11:00 AM,   1.0,0,',
  '7,9,,999,"GDEC - Mystery",,,12/22/2026,09:00 AM,12:00 PM,   3.0,2,',
].join("\r\n");

export const PLAN_MAP: W2wPositionMapEntry[] = [
  { w2wPositionId: "100", w2wPositionName: "GDEC - CA", musterPositionId: "ca", fillOrder: 0 },
  {
    w2wPositionId: "200",
    w2wPositionName: "GDEC - Stocker",
    musterPositionId: "stocker",
    fillOrder: 0,
  },
  {
    w2wPositionId: "201",
    w2wPositionName: "GDEC - Dock Stocker",
    musterPositionId: "stocker",
    fillOrder: 1,
  },
  { w2wPositionId: "300", w2wPositionName: "GDEC - SL", musterPositionId: "sl", fillOrder: 0 },
];

export const PLAN_BLOCKS: MatchBlock[] = [
  {
    id: "ca-we",
    positionId: "ca",
    dayType: "weekend",
    start: 480,
    end: 660,
    desiredCapacity: 2,
  },
  {
    id: "ca-wd",
    positionId: "ca",
    dayType: "weekday",
    start: 480,
    end: 660,
    desiredCapacity: 1,
  },
  {
    id: "st-wd",
    positionId: "stocker",
    dayType: "weekday",
    start: 420,
    end: 630,
    desiredCapacity: 2,
  },
];
