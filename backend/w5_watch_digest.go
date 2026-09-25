package main

func watchEndedDigestPayload(item changeRequestRecord) map[string]interface{} {
	return map[string]interface{}{
		"change_id":      item.ID,
		"change_number":  item.ChangeNumber,
		"sha":            item.SHA,
		"previous_sha":   item.PreviousSHA,
		"cost_delta_usd": item.CostDeltaUSD,
		"watch_result":   firstNonEmpty(item.WatchResult, changeWatchResult(item)),
		"service":        item.Service,
		"environment":    item.Environment,
		"status":         item.Status,
		"repo":           item.Repo,
	}
}

func fireWatchEndedDigest(item changeRequestRecord) {
	go FireOutboundWebhooks("watch.ended", watchEndedDigestPayload(item))
}
