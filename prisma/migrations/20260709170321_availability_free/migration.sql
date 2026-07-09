-- Create the new free-availability table first.
CREATE TABLE "AvailabilityEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'ALL',
    CONSTRAINT "AvailabilityEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityEntry_eventId_idx" ON "AvailabilityEntry"("eventId");
CREATE UNIQUE INDEX "AvailabilityEntry_eventId_memberId_date_slot_key"
    ON "AvailabilityEntry"("eventId", "memberId", "date", "slot");
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invert existing data: a responded member is free on every in-window day/slot
-- they were NOT busy on. DAY events -> one 'ALL' row per free day.
INSERT INTO "AvailabilityEntry" ("id", "eventId", "memberId", "date", "slot")
SELECT gen_random_uuid()::text, e."id", r."memberId", to_char(d, 'YYYY-MM-DD'), 'ALL'
FROM "Event" e
JOIN "Response" r ON r."eventId" = e."id"
CROSS JOIN generate_series(e."windowStart"::date, e."windowEnd"::date, interval '1 day') AS d
WHERE e."mode" = 'DAY'
  AND NOT EXISTS (
    SELECT 1 FROM "BusyEntry" b
    WHERE b."eventId" = e."id" AND b."memberId" = r."memberId"
      AND b."date" = to_char(d, 'YYYY-MM-DD')
  );

-- SLOT events -> one row per free (day, slot); a busy 'ALL' or matching slot blocks it.
INSERT INTO "AvailabilityEntry" ("id", "eventId", "memberId", "date", "slot")
SELECT gen_random_uuid()::text, e."id", r."memberId", to_char(d, 'YYYY-MM-DD'), s.slot
FROM "Event" e
JOIN "Response" r ON r."eventId" = e."id"
CROSS JOIN generate_series(e."windowStart"::date, e."windowEnd"::date, interval '1 day') AS d
CROSS JOIN (VALUES ('MORNING'), ('AFTERNOON'), ('EVENING')) AS s(slot)
WHERE e."mode" = 'SLOT'
  AND NOT EXISTS (
    SELECT 1 FROM "BusyEntry" b
    WHERE b."eventId" = e."id" AND b."memberId" = r."memberId"
      AND b."date" = to_char(d, 'YYYY-MM-DD')
      AND (b."slot" = s.slot OR b."slot" = 'ALL')
  );

-- Drop the old table last.
DROP TABLE "BusyEntry";
