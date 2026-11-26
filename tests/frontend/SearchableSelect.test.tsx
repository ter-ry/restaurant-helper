import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "../../src/components/SearchableSelect";

describe("SearchableSelect", () => {
  it("keeps partial search text without clearing the selected id", () => {
    const onChange = vi.fn();
    render(<SearchableSelect label="Inventory item" value={101} options={[{ value: 101, label: "Cheese · kg" }, { value: 102, label: "Chicken · kg" }]} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Inventory item" });
    fireEvent.change(input, { target: { value: "Che" } });
    expect(input).toHaveValue("Che");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Chicken · kg" } });
    expect(onChange).toHaveBeenLastCalledWith(102);
  });
});
