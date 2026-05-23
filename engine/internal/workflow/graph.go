package workflow

// Downstream returns all node ids reachable from nodeID via outgoing edges,
// up to maxDepth hops (PRD6 §8.1 depth-limited stale propagation). The starting
// node itself is not included. Order is unspecified.
func (d *Def) Downstream(nodeID string, maxDepth int) []string {
	seen := map[string]bool{}
	type item struct {
		id    string
		depth int
	}
	queue := []item{{nodeID, 0}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur.depth >= maxDepth {
			continue
		}
		for _, e := range d.Outgoing(cur.id) {
			if !seen[e.To] {
				seen[e.To] = true
				queue = append(queue, item{e.To, cur.depth + 1})
			}
		}
	}
	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	return out
}
