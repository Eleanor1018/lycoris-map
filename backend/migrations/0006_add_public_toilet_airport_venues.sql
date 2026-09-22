-- Extend the existing venue field without reclassifying or restoring any record.
ALTER TABLE public.map_markers DROP CONSTRAINT ck_map_markers_venue_type;
ALTER TABLE public.map_markers ADD CONSTRAINT ck_map_markers_venue_type CHECK (
    venue_type IS NULL OR (
        venue_type IN ('metro', 'hospital', 'mall', 'railway_station', 'school', 'public_toilet', 'airport', 'other')
        AND category = 'accessible_toilet'
    )
);
ALTER TABLE public.marker_edit_proposals DROP CONSTRAINT ck_marker_edit_proposals_venue_type;
ALTER TABLE public.marker_edit_proposals ADD CONSTRAINT ck_marker_edit_proposals_venue_type CHECK (
    venue_type IS NULL OR (
        venue_type IN ('metro', 'hospital', 'mall', 'railway_station', 'school', 'public_toilet', 'airport', 'other')
        AND category = 'accessible_toilet'
    )
);
