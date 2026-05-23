// Package server adapts RunnerRegistry to the generated Connect RPC service.
// It contains no persistence logic — only request/response mapping.
package server

import (
	"context"

	"connectrpc.com/connect"
	v1 "github.com/myrmidonai/myrmidon/gen/myrmidon/v1"
	"github.com/myrmidonai/myrmidon/internal/registry"
)

type RunnerServiceHandler struct {
	reg *registry.Registry
}

func NewRunnerServiceHandler(reg *registry.Registry) *RunnerServiceHandler {
	return &RunnerServiceHandler{reg: reg}
}

func (h *RunnerServiceHandler) Register(
	ctx context.Context, req *connect.Request[v1.RegisterRequest],
) (*connect.Response[v1.RegisterResponse], error) {
	if err := h.reg.Register(ctx, req.Msg.GetRunnerId(), req.Msg.GetAddress()); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&v1.RegisterResponse{Ok: true}), nil
}

func (h *RunnerServiceHandler) Heartbeat(
	ctx context.Context, req *connect.Request[v1.HeartbeatRequest],
) (*connect.Response[v1.HeartbeatResponse], error) {
	// M0: accept and ack. Persisted heartbeat handling arrives in M1.
	return connect.NewResponse(&v1.HeartbeatResponse{Ok: true}), nil
}

func (h *RunnerServiceHandler) ListRunners(
	ctx context.Context, req *connect.Request[v1.ListRunnersRequest],
) (*connect.Response[v1.ListRunnersResponse], error) {
	runners, err := h.reg.List(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &v1.ListRunnersResponse{}
	for _, r := range runners {
		resp.Runners = append(resp.Runners, &v1.Runner{
			RunnerId:           r.RunnerID,
			Address:            r.Address,
			RegisteredAtUnixMs: r.RegisteredAtUnix,
		})
	}
	return connect.NewResponse(resp), nil
}
