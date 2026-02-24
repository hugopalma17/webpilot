package main

import (
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/chzyer/readline"
	"github.com/gorilla/websocket"
)

const (
	cReset  = "\033[0m"
	cRed    = "\033[31m"
	cGreen  = "\033[32m"
	cYellow = "\033[33m"
	cDim    = "\033[2m"
	cBold   = "\033[1m"
)

var (
	conn         *websocket.Conn
	connMu       sync.Mutex
	activeTab    int64
	activeAlias  int  = -1 // short alias currently selected
	oneshot      bool      // -c mode: suppress disconnect noise
	counter      uint64
	pending      sync.Map // id -> *pendingReq
	showEvents   int32 = 1
	rl           *readline.Instance
	disconnected = make(chan struct{})

	// Tab alias map: index 0-9 -> real Chrome tab ID
	tabMap   []tabEntry
	tabMapMu sync.Mutex
)

type tabEntry struct {
	ID     int    `json:"id"`
	URL    string `json:"url"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
}

type pendingReq struct {
	action string
	ch     chan []byte
}

var protocolActions = []string{
	"tabs.list", "tabs.navigate", "tabs.create", "tabs.close",
	"tabs.activate", "tabs.reload", "tabs.waitForNavigation",
	"tabs.setViewport", "tabs.screenshot",
	"cookies.getAll", "cookies.set",
	"dom.querySelector", "dom.querySelectorAll",
	"dom.querySelectorWithin", "dom.querySelectorAllWithin",
	"dom.waitForSelector", "dom.boundingBox",
	"dom.click", "dom.mouseMoveTo", "dom.focus",
	"dom.type", "dom.keyPress", "dom.keyDown", "dom.keyUp",
	"dom.scroll", "dom.setValue", "dom.getAttribute",
	"dom.getProperty", "dom.evaluate", "dom.elementEvaluate",
	"dom.evaluateHandle", "dom.discoverElements", "dom.setDebug",
	"human.click", "human.type", "human.scroll", "human.clearInput",
	"framework.setConfig", "framework.getConfig",
}

func buildCompleter() readline.AutoCompleter {
	var items []readline.PrefixCompleterInterface
	for _, c := range []string{".help", ".quit", ".exit", ".tab", ".tabs", ".events", ".status"} {
		items = append(items, readline.PcItem(c))
	}
	for _, a := range protocolActions {
		items = append(items, readline.PcItem(a))
	}
	// Shorthands
	for _, s := range []string{"go", "click", "type", "sd", "su", "q",
		"wait", "eval", "js", "title", "url", "html", "ss", "screenshot",
		"reload", "back", "forward", "clear", "focus", "key", "discover",
		"cookies", "box"} {
		items = append(items, readline.PcItem(s))
	}
	return readline.NewPrefixCompleter(items...)
}

// --- output helpers ---

func out(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if rl != nil {
		fmt.Fprintln(rl.Stdout(), msg)
	} else {
		fmt.Println(msg)
	}
}

func nextID() string {
	return fmt.Sprintf("hb_%d", atomic.AddUint64(&counter, 1))
}

func wsSend(v interface{}) error {
	connMu.Lock()
	defer connMu.Unlock()
	return conn.WriteJSON(v)
}

// --- tab alias helpers ---

// resolveTab takes user input (short alias "0"-"9" or raw Chrome ID)
// and returns the real Chrome tab ID
func resolveTab(input string) (int64, error) {
	n, err := strconv.ParseInt(input, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid tab: %s", input)
	}

	// Check alias map first (0-9 range)
	tabMapMu.Lock()
	defer tabMapMu.Unlock()
	if n >= 0 && n < int64(len(tabMap)) {
		return int64(tabMap[int(n)].ID), nil
	}

	// Otherwise treat as raw Chrome tab ID
	return n, nil
}

func updateTabMap(tabs []tabEntry) {
	tabMapMu.Lock()
	defer tabMapMu.Unlock()
	tabMap = tabs
}

func printPrompt() {
	if rl == nil {
		return
	}
	tabMapMu.Lock()
	alias := activeAlias
	tabMapMu.Unlock()

	if alias >= 0 {
		rl.SetPrompt(fmt.Sprintf("hb[%d]> ", alias))
	} else {
		rl.SetPrompt("hb> ")
	}
}

// --- read loop ---

func readLoop() {
	defer close(disconnected)
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if !oneshot {
				out("\n%s[disconnected]%s %v", cRed, cReset, err)
			}
			return
		}

		var envelope map[string]json.RawMessage
		if err := json.Unmarshal(msg, &envelope); err != nil {
			continue
		}

		// Match response by ID
		if idRaw, ok := envelope["id"]; ok {
			var id string
			json.Unmarshal(idRaw, &id)
			if val, ok := pending.LoadAndDelete(id); ok {
				val.(*pendingReq).ch <- msg
				continue
			}
		}

		// Handle ping
		if typeRaw, ok := envelope["type"]; ok {
			var t string
			json.Unmarshal(typeRaw, &t)
			if t == "ping" {
				wsSend(map[string]string{"type": "pong"})
				continue
			}
		}

		// Print event
		if atomic.LoadInt32(&showEvents) == 1 {
			printEvent(msg)
		}
	}
}

// --- response/event formatting ---

func printEvent(msg []byte) {
	var evt struct {
		Event string          `json:"event"`
		Data  json.RawMessage `json:"data"`
	}
	if json.Unmarshal(msg, &evt) != nil || evt.Event == "" {
		return
	}
	pretty, _ := json.MarshalIndent(json.RawMessage(evt.Data), "  ", "  ")
	out("%s[%s]%s %s", cYellow, evt.Event, cReset, string(pretty))
}

func printResponse(raw []byte, action string) {
	var resp struct {
		ID     string          `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		out("%sparse error:%s %v", cRed, cReset, err)
		return
	}

	if resp.Error != "" {
		out("%serror:%s %s", cRed, cReset, resp.Error)
		return
	}

	// Screenshot: save to file instead of dumping base64
	if action == "tabs.screenshot" {
		var obj map[string]interface{}
		if json.Unmarshal(resp.Result, &obj) == nil {
			if dataUrl, ok := obj["dataUrl"].(string); ok {
				saveScreenshot(dataUrl)
				return
			}
		}
	}

	// tabs.list: formatted table with short aliases
	if action == "tabs.list" {
		var tabs []tabEntry
		if json.Unmarshal(resp.Result, &tabs) == nil && len(tabs) > 0 {
			updateTabMap(tabs)
			for i, t := range tabs {
				marker := "  "
				if t.Active {
					marker = cGreen + "* " + cReset
				}
				title := t.Title
				if len(title) > 50 {
					title = title[:47] + "..."
				}
				selected := " "
				if int64(t.ID) == atomic.LoadInt64(&activeTab) {
					selected = cGreen + ">" + cReset
				}
				out("%s %s%d%s  %s%d%s  %s  %s%s%s",
					selected, cBold, i, cReset,
					cDim, t.ID, cReset,
					t.URL,
					cDim, title, cReset)
				_ = marker
			}
			out("%s  .tab <0-%d> to target a tab%s", cDim, len(tabs)-1, cReset)
			return
		}
	}

	// dom.discoverElements: formatted element list
	if action == "dom.discoverElements" {
		var disc struct {
			Elements []struct {
				Type      string `json:"type"`
				Tag       string `json:"tag"`
				Text      string `json:"text"`
				Href      string `json:"href"`
				HandleId  string `json:"handleId"`
				Selector  string `json:"selector"`
				InputType string `json:"inputType"`
				Name      string `json:"name"`
				Placeholder string `json:"placeholder"`
			} `json:"elements"`
		}
		if json.Unmarshal(resp.Result, &disc) == nil && len(disc.Elements) > 0 {
			links, buttons, inputs := 0, 0, 0
			for _, el := range disc.Elements {
				switch el.Type {
				case "link":
					links++
				case "button":
					buttons++
				case "input":
					inputs++
				}
			}
			out("%s%d elements%s  %s(%d links, %d buttons, %d inputs)%s",
				cBold, len(disc.Elements), cReset, cDim, links, buttons, inputs, cReset)
			out("")
			for _, el := range disc.Elements {
				label := el.Text
				if len(label) > 50 {
					label = label[:47] + "..."
				}
				switch el.Type {
				case "link":
					href := el.Href
					if len(href) > 60 {
						href = href[:57] + "..."
					}
					out("  %s%s%s  %s[link]%s  %s\"%s\"%s  %s→ %s%s",
						cGreen, el.HandleId, cReset, cYellow, cReset,
						cDim, label, cReset, cDim, href, cReset)
				case "button":
					out("  %s%s%s  %s[btn]%s   %s\"%s\"%s  %s%s%s",
						cGreen, el.HandleId, cReset, cYellow, cReset,
						cDim, label, cReset, cDim, el.Selector, cReset)
				case "input":
					desc := el.InputType
					if el.Name != "" {
						desc += " name=" + el.Name
					}
					if el.Placeholder != "" {
						desc += " \"" + el.Placeholder + "\""
					}
					out("  %s%s%s  %s[input]%s %s%s%s  %s%s%s",
						cGreen, el.HandleId, cReset, cYellow, cReset,
						cDim, desc, cReset, cDim, el.Selector, cReset)
				}
			}
			return
		}
	}

	// Default: pretty-print JSON
	var v interface{}
	json.Unmarshal(resp.Result, &v)
	pretty, _ := json.MarshalIndent(v, "", "  ")
	out("%s", string(pretty))
}

func saveScreenshot(dataUrl string) {
	idx := strings.Index(dataUrl, ",")
	if idx < 0 {
		out("%serror:%s invalid screenshot data", cRed, cReset)
		return
	}
	data, err := base64.StdEncoding.DecodeString(dataUrl[idx+1:])
	if err != nil {
		out("%serror:%s decode: %v", cRed, cReset, err)
		return
	}
	name := fmt.Sprintf("screenshot_%s.png", time.Now().Format("20060102_150405"))
	if err := os.WriteFile(name, data, 0644); err != nil {
		out("%serror:%s write: %v", cRed, cReset, err)
		return
	}
	out("%sscreenshot:%s %s (%d bytes)", cGreen, cReset, name, len(data))
}

// --- low-level send helper (returns result, for chaining) ---

func sendAndWait(action string, params map[string]interface{}) (json.RawMessage, error) {
	id := nextID()
	paramsJSON, _ := json.Marshal(params)
	msg := map[string]interface{}{
		"id":     id,
		"action": action,
		"params": json.RawMessage(paramsJSON),
	}
	if tab := atomic.LoadInt64(&activeTab); tab != 0 {
		msg["tabId"] = tab
	}

	req := &pendingReq{action: action, ch: make(chan []byte, 1)}
	pending.Store(id, req)

	if err := wsSend(msg); err != nil {
		pending.Delete(id)
		return nil, err
	}

	select {
	case raw := <-req.ch:
		var resp struct {
			Result json.RawMessage `json:"result"`
			Error  string          `json:"error"`
		}
		json.Unmarshal(raw, &resp)
		if resp.Error != "" {
			return nil, fmt.Errorf("%s", resp.Error)
		}
		return resp.Result, nil
	case <-time.After(35 * time.Second):
		pending.Delete(id)
		return nil, fmt.Errorf("timeout")
	case <-disconnected:
		pending.Delete(id)
		return nil, fmt.Errorf("disconnected")
	}
}

type elInfo struct {
	Tag   string `json:"tag"`
	ID    string `json:"id"`
	Cls   string `json:"cls"`
	Text  string `json:"text"`
	Label string `json:"label"`
}

const elInfoJS = `(el) => ({
	tag: el.tagName.toLowerCase(),
	id: el.id || null,
	cls: [...el.classList].slice(0,3).join(' ') || null,
	text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) || null,
	label: el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : null),
})`

func formatEl(el elInfo) string {
	idStr := ""
	if el.ID != "" {
		idStr = "#" + el.ID
	}
	clsStr := ""
	if el.Cls != "" {
		clsStr = "." + strings.ReplaceAll(el.Cls, " ", ".")
	}
	desc := fmt.Sprintf("<%s%s%s>", el.Tag, idStr, clsStr)
	// Prefer aria-label/name, fall back to text content
	if el.Label != "" {
		label := el.Label
		if len(label) > 50 {
			label = label[:47] + "..."
		}
		desc += fmt.Sprintf(" %s\"%s\"%s", cDim, label, cReset)
	} else if el.Text != "" {
		text := el.Text
		if len(text) > 50 {
			text = text[:47] + "..."
		}
		desc += fmt.Sprintf(" %s\"%s\"%s", cDim, text, cReset)
	}
	return desc
}

// loadCookies: read JSON file and inject each cookie via cookies.set
func loadCookies(args string) {
	parts := strings.Fields(args)
	file := "cookies.json"
	if len(parts) > 1 {
		file = parts[1]
	}

	data, err := os.ReadFile(file)
	if err != nil {
		out("%serror:%s %v", cRed, cReset, err)
		return
	}

	var cookies []map[string]interface{}
	if err := json.Unmarshal(data, &cookies); err != nil {
		out("%serror:%s invalid JSON: %v", cRed, cReset, err)
		return
	}

	ok, fail := 0, 0
	for _, c := range cookies {
		params, _ := json.Marshal(map[string]interface{}{"cookie": c})
		_, err := sendAndWait("cookies.set", map[string]interface{}{"cookie": c})
		_ = params
		if err != nil {
			fail++
		} else {
			ok++
		}
	}
	out("%s%d cookies loaded%s, %d failed", cGreen, ok, cReset, fail)
}

// doQuery: find ALL matching elements, register handles, show info — single round-trip
func doQuery(selector string) {
	out("%s-> q %s%s", cDim, selector, cReset)

	result, err := sendAndWait("dom.queryAllInfo", map[string]interface{}{"selector": selector})
	if err != nil {
		out("%serror:%s %v", cRed, cReset, err)
		return
	}

	var elements []struct {
		HandleId string `json:"handleId"`
		elInfo
	}
	if err := json.Unmarshal(result, &elements); err != nil || len(elements) == 0 {
		out("%s(no matches)%s", cDim, cReset)
		return
	}

	out("%s%d match(es)%s", cBold, len(elements), cReset)
	for _, el := range elements {
		out("  %s%s%s  %s", cGreen, el.HandleId, cReset, formatEl(el.elInfo))
	}
}

// --- command dispatch ---

func dispatch(line string) {
	if strings.HasPrefix(line, ".") {
		dotCommand(line)
		return
	}
	if strings.HasPrefix(line, "{") {
		sendRawJSON(line)
		return
	}

	// Shorthand commands — human-friendly syntax
	if handled := tryShorthand(line); handled {
		return
	}

	// action [params]
	parts := strings.SplitN(line, " ", 2)
	action := parts[0]
	params := "{}"
	if len(parts) > 1 {
		params = parts[1]
	}
	sendCommand(action, params)
}

// tryShorthand handles human-friendly shortcuts.
// Returns true if the line was handled.
func tryShorthand(line string) bool {
	parts := strings.Fields(line)
	cmd := strings.ToLower(parts[0])
	rest := ""
	if len(parts) > 1 {
		rest = strings.Join(parts[1:], " ")
	}

	switch cmd {
	case "go", "nav", "navigate", "goto":
		// go https://example.com
		if rest == "" {
			out("%susage: go <url>%s", cDim, cReset)
			return true
		}
		url := rest
		if !strings.Contains(url, "://") {
			if strings.HasPrefix(url, "localhost") || strings.HasPrefix(url, "127.0.0.1") {
				url = "http://" + url
			} else {
				url = "https://" + url
			}
		}
		sendCommand("tabs.navigate", fmt.Sprintf(`{"url":%q}`, url))
		return true

	case "click":
		// click button.submit  OR  click el_5
		if rest == "" {
			out("%susage: click <selector|handleId>%s", cDim, cReset)
			return true
		}
		if strings.HasPrefix(rest, "el_") {
			sendCommand("human.click", fmt.Sprintf(`{"handleId":%q}`, rest))
		} else {
			sendCommand("human.click", fmt.Sprintf(`{"selector":%q}`, rest))
		}
		return true

	case "type":
		// type #selector some text here
		// type some text here  (types into focused element)
		if rest == "" {
			out("%susage: type [selector] <text>%s", cDim, cReset)
			return true
		}
		// If first arg looks like a selector (starts with # . [ or contains =)
		firstWord := parts[1]
		if len(parts) > 2 && (strings.HasPrefix(firstWord, "#") ||
			strings.HasPrefix(firstWord, ".") ||
			strings.HasPrefix(firstWord, "[") ||
			strings.Contains(firstWord, "=")) {
			selector := firstWord
			text := strings.Join(parts[2:], " ")
			sendCommand("human.type", fmt.Sprintf(`{"selector":%q,"text":%q}`, selector, text))
		} else {
			sendCommand("human.type", fmt.Sprintf(`{"text":%q}`, rest))
		}
		return true

	case "sd":
		// sd [amount] [selector]  →  scroll down
		params := `{"direction":"down"`
		for _, p := range parts[1:] {
			if n, err := strconv.Atoi(p); err == nil {
				params += fmt.Sprintf(`,"amount":%d`, n)
			} else {
				params += fmt.Sprintf(`,"selector":%q`, p)
			}
		}
		params += "}"
		sendCommand("human.scroll", params)
		return true

	case "su":
		// su [amount] [selector]  →  scroll up
		params := `{"direction":"up"`
		for _, p := range parts[1:] {
			if n, err := strconv.Atoi(p); err == nil {
				params += fmt.Sprintf(`,"amount":%d`, n)
			} else {
				params += fmt.Sprintf(`,"selector":%q`, p)
			}
		}
		params += "}"
		sendCommand("human.scroll", params)
		return true

	case "q", "query":
		// q h1  →  find ALL matches, register handles, show info
		if rest == "" {
			out("%susage: q <selector>%s", cDim, cReset)
			return true
		}
		doQuery(rest)
		return true

	case "wait":
		// wait .loaded  →  dom.waitForSelector
		if rest == "" {
			out("%susage: wait <selector>%s", cDim, cReset)
			return true
		}
		sendCommand("dom.waitForSelector", fmt.Sprintf(`{"selector":%q}`, rest))
		return true

	case "eval", "js":
		// eval document.title  →  dom.evaluate
		if rest == "" {
			out("%susage: eval <js expression>%s", cDim, cReset)
			return true
		}
		// Wrap in arrow function if not already
		fn := rest
		if !strings.HasPrefix(fn, "()") && !strings.HasPrefix(fn, "function") {
			fn = "() => " + fn
		}
		sendCommand("dom.evaluate", fmt.Sprintf(`{"fn":%q}`, fn))
		return true

	case "title":
		sendCommand("dom.evaluate", `{"fn":"() => document.title"}`)
		return true

	case "url":
		sendCommand("dom.evaluate", `{"fn":"() => location.href"}`)
		return true

	case "html":
		sendCommand("dom.evaluate", `{"fn":"() => document.documentElement.outerHTML"}`)
		return true

	case "screenshot", "ss":
		sendCommand("tabs.screenshot", "{}")
		return true

	case "reload":
		sendCommand("tabs.reload", "{}")
		return true

	case "back":
		sendCommand("dom.evaluate", `{"fn":"() => { history.back(); return true; }"}`)
		return true

	case "forward":
		sendCommand("dom.evaluate", `{"fn":"() => { history.forward(); return true; }"}`)
		return true

	case "clear":
		// clear #input  →  human.clearInput
		if rest == "" {
			out("%susage: clear <selector>%s", cDim, cReset)
			return true
		}
		sendCommand("human.clearInput", fmt.Sprintf(`{"selector":%q}`, rest))
		return true

	case "focus":
		if rest == "" {
			out("%susage: focus <selector>%s", cDim, cReset)
			return true
		}
		sendCommand("dom.focus", fmt.Sprintf(`{"selector":%q}`, rest))
		return true

	case "key", "press":
		// key Enter  →  dom.keyPress
		if rest == "" {
			out("%susage: key <keyname>%s", cDim, cReset)
			return true
		}
		sendCommand("dom.keyPress", fmt.Sprintf(`{"key":%q}`, rest))
		return true

	case "discover":
		sendCommand("dom.discoverElements", "{}")
		return true

	case "frames":
		sendCommand("frames.list", "{}")
		return true

	case "cookies":
		if rest == "" || rest == "get" {
			sendCommand("cookies.getAll", "{}")
		} else if strings.HasPrefix(rest, "load") {
			loadCookies(rest)
		} else {
			out("%susage: cookies [get|load <file>]%s", cDim, cReset)
		}
		return true

	case "box":
		// box #element  →  dom.boundingBox
		if rest == "" {
			out("%susage: box <selector|handleId>%s", cDim, cReset)
			return true
		}
		if strings.HasPrefix(rest, "el_") {
			sendCommand("dom.boundingBox", fmt.Sprintf(`{"handleId":%q}`, rest))
		} else {
			sendCommand("dom.boundingBox", fmt.Sprintf(`{"selector":%q}`, rest))
		}
		return true
	}

	return false
}

func sendCommand(action, paramsJSON string) {
	var params json.RawMessage
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		out("%sinvalid params:%s %v", cRed, cReset, err)
		out("  %susage: %s {\"key\": \"value\"}%s", cDim, action, cReset)
		return
	}

	id := nextID()
	msg := map[string]interface{}{
		"id":     id,
		"action": action,
		"params": params,
	}
	if tab := atomic.LoadInt64(&activeTab); tab != 0 {
		msg["tabId"] = tab
	}

	req := &pendingReq{action: action, ch: make(chan []byte, 1)}
	pending.Store(id, req)

	if err := wsSend(msg); err != nil {
		pending.Delete(id)
		out("%ssend failed:%s %v", cRed, cReset, err)
		return
	}

	out("%s-> %s%s", cDim, action, cReset)

	select {
	case resp := <-req.ch:
		printResponse(resp, action)
	case <-time.After(35 * time.Second):
		pending.Delete(id)
		out("%stimeout%s (35s)", cRed, cReset)
	case <-disconnected:
		pending.Delete(id)
		out("%sdisconnected%s", cRed, cReset)
	}
}

func sendRawJSON(raw string) {
	var msg map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &msg); err != nil {
		out("%sinvalid JSON:%s %v", cRed, cReset, err)
		return
	}

	id, hasID := msg["id"].(string)
	if !hasID {
		id = nextID()
		msg["id"] = id
	}

	action, _ := msg["action"].(string)
	req := &pendingReq{action: action, ch: make(chan []byte, 1)}
	pending.Store(id, req)

	if err := wsSend(msg); err != nil {
		pending.Delete(id)
		out("%ssend failed:%s %v", cRed, cReset, err)
		return
	}

	out("%s-> %s%s", cDim, action, cReset)

	select {
	case resp := <-req.ch:
		printResponse(resp, action)
	case <-time.After(35 * time.Second):
		pending.Delete(id)
		out("%stimeout%s (35s)", cRed, cReset)
	case <-disconnected:
		pending.Delete(id)
		out("%sdisconnected%s", cRed, cReset)
	}
}

// --- dot commands ---

func dotCommand(line string) {
	parts := strings.Fields(line)
	cmd := parts[0]

	switch cmd {
	case ".help":
		out("")
		out("%sNavigation%s", cBold, cReset)
		out("  go <url>             navigate (auto-adds https://)")
		out("  reload / back        page navigation")
		out("  sd [px] [sel]        scroll down (optional amount + selector)")
		out("  su [px] [sel]        scroll up")
		out("")
		out("%sQuery%s", cBold, cReset)
		out("  q <sel>              find all matches (handles + info)")
		out("  wait <sel>           wait for selector")
		out("  discover             list interactive elements")
		out("")
		out("%sInteract%s", cBold, cReset)
		out("  click <sel|handle>   human click")
		out("  type [sel] <text>    human type (sel: # . [ auto-detected)")
		out("  clear <sel>          clear input")
		out("  focus <sel>          focus element")
		out("  key <name>           keyPress (Enter, Tab, Escape...)")
		out("")
		out("%sInspect%s", cBold, cReset)
		out("  eval <js>            evaluate JS expression")
		out("  title / url / html   quick page info")
		out("  ss                   screenshot (saves to file)")
		out("  box <sel>            bounding box")
		out("  cookies              dump all cookies")
		out("")
		out("%sMeta%s", cBold, cReset)
		out("  .tabs                list tabs (0-9 aliases)")
		out("  .tab <n>             set active tab by alias or ID")
		out("  .events              toggle event display")
		out("  .status              connection info")
		out("  .quit                exit")
		out("")
		out("%sRaw mode%s", cBold, cReset)
		out("  action.name {json}   full protocol command")
		out("  {raw json}           raw WebSocket message")
		out("")

	case ".quit", ".exit":
		out(cDim + "bye" + cReset)
		conn.Close()
		os.Exit(0)

	case ".tab":
		if len(parts) > 1 {
			realID, err := resolveTab(parts[1])
			if err != nil {
				out("%s%v%s", cRed, err, cReset)
				return
			}
			atomic.StoreInt64(&activeTab, realID)

			// Track alias for prompt
			n, _ := strconv.Atoi(parts[1])
			tabMapMu.Lock()
			if n >= 0 && n < len(tabMap) && int64(tabMap[n].ID) == realID {
				activeAlias = n
			} else {
				activeAlias = -1
			}
			tabMapMu.Unlock()

			// Show what was selected
			tabMapMu.Lock()
			var label string
			for _, t := range tabMap {
				if int64(t.ID) == realID {
					label = t.URL
					if len(label) > 60 {
						label = label[:57] + "..."
					}
					break
				}
			}
			tabMapMu.Unlock()

			if label != "" {
				out("tab -> %s%d%s  %s", cGreen, realID, cReset, label)
			} else {
				out("tab -> %s%d%s", cGreen, realID, cReset)
			}
			printPrompt()
		} else {
			tab := atomic.LoadInt64(&activeTab)
			if tab == 0 {
				out("no active tab %s(using server default)%s", cDim, cReset)
			} else {
				tabMapMu.Lock()
				var label string
				for i, t := range tabMap {
					if int64(t.ID) == tab {
						label = fmt.Sprintf(" [%d] %s", i, t.URL)
						break
					}
				}
				tabMapMu.Unlock()
				out("active tab: %d%s", tab, label)
			}
		}

	case ".tabs":
		sendCommand("tabs.list", "{}")

	case ".events":
		if atomic.LoadInt32(&showEvents) == 1 {
			atomic.StoreInt32(&showEvents, 0)
			out("events %soff%s", cDim, cReset)
		} else {
			atomic.StoreInt32(&showEvents, 1)
			out("events %son%s", cGreen, cReset)
		}

	case ".status":
		tab := atomic.LoadInt64(&activeTab)
		ev := cGreen + "on" + cReset
		if atomic.LoadInt32(&showEvents) == 0 {
			ev = cDim + "off" + cReset
		}
		out("connected: %syes%s", cGreen, cReset)
		if tab == 0 {
			out("tab:       %s(default)%s", cDim, cReset)
		} else {
			out("tab:       %d", tab)
		}
		out("events:    %s", ev)

	default:
		out("%sunknown: %s%s %s(try .help)%s", cRed, cmd, cReset, cDim, cReset)
	}
}

// --- main ---

func main() {
	addr := flag.String("addr", "ws://localhost:7331", "WebSocket address")
	cmd := flag.String("c", "", "Execute command and exit")
	flag.Parse()

	c, _, err := websocket.DefaultDialer.Dial(*addr, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%sfailed to connect:%s %v\n", cRed, cReset, err)
		fmt.Fprintf(os.Stderr, "%sis the server running? (node index.js)%s\n", cDim, cReset)
		os.Exit(1)
	}
	conn = c

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() {
		<-sig
		fmt.Println()
		conn.Close()
		os.Exit(0)
	}()

	go readLoop()

	// Non-interactive mode: execute command and exit
	if *cmd != "" {
		oneshot = true
		dispatch(*cmd)
		conn.Close()
		os.Exit(0)
	}

	home, _ := os.UserHomeDir()
	histFile := filepath.Join(home, ".hb_history")

	rl, err = readline.NewEx(&readline.Config{
		Prompt:       "hb> ",
		AutoComplete: buildCompleter(),
		EOFPrompt:    "quit",
		HistoryFile:  histFile,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "readline: %v\n", err)
		os.Exit(1)
	}
	defer rl.Close()

	out("%sconnected%s to %s", cGreen, cReset, *addr)

	// Auto-fetch tabs on connect
	sendCommand("tabs.list", "{}")

	for {
		line, err := rl.Readline()
		if err != nil {
			break
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		dispatch(line)
	}

	conn.Close()
}
