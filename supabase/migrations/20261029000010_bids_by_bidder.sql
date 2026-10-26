-- Meus arremates looks up a bidder's bids: without this index every request scans the whole bid history.
create index bids_by_bidder on public.bids (bidder_id);
