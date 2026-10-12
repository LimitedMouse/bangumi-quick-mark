// The editor owns the baseline and user changes. DOM rendering never decides what to save.
class CollectionEditor {
  base = null;
  value = null;

  load(collection, job = null, draft = null) {
    const baseline =
      job?.kind === "remove"
        ? { interest: "", rating: "", comment: "" }
        : { ...collection, ...(job?.changes || {}) };
    this.base = {
      interest: baseline.interest || "",
      rating: baseline.rating || "",
      comment: baseline.comment || "",
    };
    this.value = {
      interest: this.base.interest || "2",
      rating: "keep",
      comment: this.base.comment,
    };
    if (draft && typeof draft === "object") {
      if (/^[1-5]$/.test(draft.interest || ""))
        this.value.interest = draft.interest;
      if (typeof draft.rating === "string" && /^([1-9]|10)$/.test(draft.rating))
        this.value.rating = draft.rating;
      if (typeof draft.comment === "string") this.value.comment = draft.comment;
    }
  }

  reset() {
    this.base = null;
    this.value = null;
  }

  set(field, value) {
    if (!this.value) return;
    if (field === "interest" && /^[1-5]$/.test(value))
      this.value.interest = value;
    if (field === "rating" && /^(keep|[1-9]|10)$/.test(value))
      this.value.rating = value;
    if (field === "comment" && typeof value === "string")
      this.value.comment = value;
  }

  changes() {
    if (!this.base) return {};
    const changes = {};
    if (this.value.interest !== (this.base.interest || "2"))
      changes.interest = this.value.interest;
    if (this.value.rating !== "keep") changes.rating = this.value.rating;
    if (this.value.comment !== this.base.comment)
      changes.comment = this.value.comment;
    return changes;
  }

  submission(action = "save", score) {
    const changes = this.changes();
    if (!this.base.interest) changes.interest = this.value.interest;
    if (action === "wish") changes.interest = "1";
    if (score !== undefined) changes.rating = String(score);
    return changes;
  }

  accept(changes) {
    this.load({ ...this.base, ...changes });
  }

  actionLabel(type) {
    const interest = this.value?.interest || "2";
    const rating = this.value?.rating || "keep";
    return `${interestLabels(type)[interest]}，${rating === "keep" ? "不评分" : rating + " 分"}`;
  }
}
