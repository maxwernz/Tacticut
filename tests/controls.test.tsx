// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "../src/Select";
import { ClipEditor } from "../src/ClipEditor";
import { ColorPicker } from "../src/ColorPicker";
afterEach(cleanup);
it("uses an app-owned dropdown with keyboard selection and outside dismissal", () => {
  const change = vi.fn();
  render(
    <Select
      label="Sort"
      value="a"
      onChange={change}
      options={[
        { value: "a", label: "Category" },
        { value: "b", label: "Time" },
      ]}
    />,
  );
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("b");
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.querySelector("select")).toBeNull();
});
it("offers category colors without an OS color dialog", () => {
  const change = vi.fn();
  render(
    <ColorPicker label="Category color" value="#3B82F6" onChange={change} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Category color" }));
  fireEvent.click(screen.getByRole("button", { name: "Use #EF4444" }));
  expect(change).toHaveBeenCalledWith("#EF4444");
  expect(document.querySelector("input[type=color]")).toBeNull();
});
it("edits a colored handball sequence and previews the chosen interval", () => {
  const save = vi.fn(),
    preview = vi.fn(),
    stop = vi.fn();
  const ui = render(
    <ClipEditor
      clip={{
        id: "clip",
        source_video_id: "source",
        name: "Attack",
        start_ms: 1000,
        end_ms: 4000,
        notes: "",
        category_id: null,
        creation_order: 0,
      }}
      categories={[{ id: "attack", name: "Angriff", color: "#EF4444" }]}
      duration={10000}
      current={() => 2000}
      onSeek={vi.fn()}
      onSave={save}
      onCancel={vi.fn()}
      onPreview={preview}
      onStopPreview={stop}
    />,
  );
  const category = screen.getByRole("button", { name: "Angriff" });
  fireEvent.click(category);
  expect(category.getAttribute("aria-pressed")).toBe("true");
  expect(category.style.getPropertyValue("--category-color")).toBe("#EF4444");
  fireEvent.click(screen.getByText("Handball coaching prompts"));
  fireEvent.click(screen.getByRole("combobox", { name: "Add tactical phase" }));
  fireEvent.click(screen.getByRole("option", { name: "Fast break" }));
  fireEvent.click(screen.getByRole("button", { name: "Loop" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview sequence" }));
  expect(preview).toHaveBeenCalledWith(1000, 4000, true);
  fireEvent.click(screen.getByRole("button", { name: "Save Clip" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      category_id: "attack",
      notes: "Phase: Fast break",
      start_ms: 1000,
      end_ms: 4000,
    }),
  );
  ui.unmount();
  expect(stop).toHaveBeenCalled();
});
