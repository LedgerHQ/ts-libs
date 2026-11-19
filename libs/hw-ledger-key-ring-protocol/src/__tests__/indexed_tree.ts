import { IndexedTree } from "../IndexedTree";

describe("Indexed tree unit test suite", () => {
  it("should create a new tree with a root", () => {
    const tree = new IndexedTree(0);
    expect(tree.getValue()).toBe(0);
  });

  it("should create a new tree with a root and update the root", () => {
    let tree = new IndexedTree(0);
    tree = tree.updateChild([], 1);
    expect(tree.getValue()).toBe(1);
  });

  it("should create a new tree with a root and update a child", () => {
    let tree = new IndexedTree(0);
    tree = tree.updateChild([1], 1);
    expect(tree.getChild(1)!.getValue()).toBe(1);
  });

  it("should create a tree with multiple children and update a child which had no value before", () => {
    let tree = new IndexedTree(0);
    tree = tree.updateChild([0, 1], 1);
    tree = tree.updateChild([0, 2], 2);

    expect(tree.findChild([0, 1])!.getValue()).toBe(1);
    expect(tree.findChild([0, 2])!.getValue()).toBe(2);
    expect(tree.getChild(0)?.getValue()).toBe(null);

    tree = tree.updateChild([0], 42);
    expect(tree.getChild(0)?.getValue()).toBe(42);
  });
});
