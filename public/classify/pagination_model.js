(function (root) {
  function page_count(total, page_size) {
    return Math.max(1, Math.ceil(Math.max(0, total) / page_size));
  }

  function clamp_page(page, total, page_size) {
    return Math.min(Math.max(1, page), page_count(total, page_size));
  }

  function slice_page(items, page, page_size) {
    var safe_page = clamp_page(page, items.length, page_size);
    var start = (safe_page - 1) * page_size;
    return items.slice(start, start + page_size);
  }

  function visible_pages(total_pages, current_page, radius) {
    var nearby = typeof radius === 'number' ? radius : 1;
    if (total_pages <= nearby * 2 + 5) {
      var all = [];
      for (var n = 1; n <= total_pages; n += 1) all.push(n);
      return all;
    }
    var pages = [1];
    var start = Math.max(2, current_page - nearby);
    var end = Math.min(total_pages - 1, current_page + nearby);
    if (start > 2) pages.push('ellipsis-start');
    for (var i = start; i <= end; i += 1) pages.push(i);
    if (end < total_pages - 1) pages.push('ellipsis-end');
    pages.push(total_pages);
    return pages;
  }

  function create_request_gate() {
    var latest = 0;
    return {
      next: function () {
        latest += 1;
        return latest;
      },
      is_current: function (request_id) {
        return request_id === latest;
      },
    };
  }

  root.ClassifyPaginationModel = {
    page_count: page_count,
    clamp_page: clamp_page,
    slice_page: slice_page,
    visible_pages: visible_pages,
    create_request_gate: create_request_gate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
