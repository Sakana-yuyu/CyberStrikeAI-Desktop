//go:build windows

package handler

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestWindowsConPTYEcho(t *testing.T) {
	session, err := startWindowsPTY(80, 24)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := session.Close(); err != nil {
			t.Error(err)
		}
	})

	if err := session.Resize(100, 30); err != nil {
		t.Fatal(err)
	}

	got := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		tmp := make([]byte, 1024)
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			n, readErr := session.Read(tmp)
			if n > 0 {
				buf.Write(tmp[:n])
				if strings.Contains(buf.String(), "CYBERSTRIKE_PTY_OK") {
					got <- buf.String()
					return
				}
			}
			if readErr != nil {
				got <- buf.String()
				return
			}
		}
		got <- buf.String()
	}()

	time.Sleep(400 * time.Millisecond)
	if _, err := session.Write([]byte("echo CYBERSTRIKE_PTY_OK\r")); err != nil {
		t.Fatal(err)
	}

	select {
	case output := <-got:
		if !strings.Contains(output, "CYBERSTRIKE_PTY_OK") {
			t.Fatalf("shell output %q", output)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for shell output")
	}
}
