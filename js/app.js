(function () {
  'use strict';

  var CHINA_STORAGE_KEY = 'visitedCities';
  var WORLD_STORAGE_KEY = 'visitedCountries';
  var VIEW_STORAGE_KEY = 'mapView';
  var MODE_STORAGE_KEY = 'mapMode';
  var PROVINCE_GEOJSON_URL = 'data/china.json';
  var CITY_GEOJSON_URL = 'data/china-cities.json';
  var WORLD_GEOJSON_URL = 'data/world.json';
  var VIEWS = ['china', 'world'];
  var MODES = ['off', 'province', 'city'];
  // Which registered map + granularity of highlighting each China mode uses.
  var MODE_MAP = { off: 'china', province: 'china', city: 'china-cities' };

  var DATASETS = {
    china: {
      list: CITIES,
      storageKey: CHINA_STORAGE_KEY,
      groupField: 'province',
      searchPlaceholder: '输入城市名，如：杭州',
      searchTitle: '添加到访城市',
      visitedTitle: '已点亮城市',
      emptyText: '还没有添加城市，快去点亮地图吧～',
      itemCountLabel: '到访城市',
      groupCountLabel: '覆盖省份',
      noun: '城市',
    },
    world: {
      list: COUNTRIES,
      storageKey: WORLD_STORAGE_KEY,
      groupField: 'continent',
      searchPlaceholder: '输入国家名，如：日本',
      searchTitle: '添加到访国家',
      visitedTitle: '已点亮国家',
      emptyText: '还没有添加国家，快去点亮世界地图吧～',
      itemCountLabel: '到访国家',
      groupCountLabel: '覆盖大洲',
      noun: '国家',
    },
  };

  function itemKey(view, item) {
    return view === 'world' ? item.regionName : item.name + '|' + item.province;
  }

  // regionName -> display name / full record, for tooltips + map-click selection.
  var REGION_DISPLAY = {};
  var REGION_TO_CITY = {};
  CITIES.forEach(function (c) {
    REGION_DISPLAY[c.regionName] = c.name;
    REGION_TO_CITY[c.regionName] = c;
  });

  var COUNTRY_DISPLAY = {};
  var REGION_TO_COUNTRY = {};
  COUNTRIES.forEach(function (c) {
    COUNTRY_DISPLAY[c.regionName] = c.name;
    REGION_TO_COUNTRY[c.regionName] = c;
  });

  var state = {
    view: loadView(),
    mode: loadMode(),
    visitedByView: {
      china: loadVisited('china'),
      world: loadVisited('world'),
    },
    selectedItem: null,
    activeSuggestIndex: -1,
    currentSuggestions: [],
  };

  var chart = null;

  var els = {
    mapContainer: document.getElementById('mapContainer'),
    mapLoading: document.getElementById('mapLoading'),
    viewButtons: document.querySelectorAll('.view-btn'),
    chinaModeSwitch: document.getElementById('chinaModeSwitch'),
    modeButtons: document.querySelectorAll('.mode-btn'),
    searchPanelTitle: document.getElementById('searchPanelTitle'),
    visitedPanelTitle: document.getElementById('visitedPanelTitle'),
    searchInput: document.getElementById('citySearchInput'),
    suggestList: document.getElementById('suggestList'),
    confirmBtn: document.getElementById('confirmAddBtn'),
    searchHint: document.getElementById('searchHint'),
    itemCount: document.getElementById('itemCount'),
    itemCountLabel: document.getElementById('itemCountLabel'),
    groupCount: document.getElementById('groupCount'),
    groupCountLabel: document.getElementById('groupCountLabel'),
    visitedList: document.getElementById('visitedList'),
  };

  function dataset() {
    return DATASETS[state.view];
  }

  function visitedList() {
    return state.visitedByView[state.view];
  }

  function loadVisited(view) {
    try {
      var raw = localStorage.getItem(DATASETS[view].storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveVisited() {
    localStorage.setItem(dataset().storageKey, JSON.stringify(visitedList()));
  }

  function loadView() {
    var saved = localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEWS.indexOf(saved) !== -1 ? saved : 'china';
  }

  function loadMode() {
    var saved = localStorage.getItem(MODE_STORAGE_KEY);
    return MODES.indexOf(saved) !== -1 ? saved : 'off';
  }

  function isVisited(item) {
    var key = itemKey(state.view, item);
    return visitedList().some(function (v) {
      return itemKey(state.view, v) === key;
    });
  }

  // ---------- Map ----------

  function initChart() {
    chart = echarts.init(els.mapContainer);
    window.addEventListener('resize', function () {
      chart.resize();
    });

    chart.on('click', function (params) {
      if (params.componentType !== 'geo') return;
      if (state.view === 'china') {
        if (state.mode !== 'city') return;
        var city = REGION_TO_CITY[params.name];
        if (city) selectItem(city);
      } else {
        var country = REGION_TO_COUNTRY[params.name];
        if (country) selectItem(country);
      }
    });

    function loadMap(url) {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('geojson fetch failed: ' + res.status);
        return res.json();
      });
    }

    Promise.all([
      loadMap(PROVINCE_GEOJSON_URL),
      loadMap(CITY_GEOJSON_URL),
      loadMap(WORLD_GEOJSON_URL),
    ])
      .then(function (results) {
        echarts.registerMap('china', results[0]);
        echarts.registerMap('china-cities', results[1]);
        echarts.registerMap('world', results[2]);
        els.mapLoading.style.display = 'none';
        renderChart();
      })
      .catch(function (err) {
        els.mapLoading.textContent = '地图加载失败，请检查网络后刷新页面';
        console.error(err);
      });
  }

  // Bounding-box + zoom heuristics so small highlighted regions are actually
  // visible instead of being a speck on the full map view.
  function computeViewport(items, opts) {
    if (!items.length) return null;
    var minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    items.forEach(function (item) {
      var b = opts.bbox ? opts.bbox(item) : [item.lng, item.lat, item.lng, item.lat];
      if (b[0] < minLng) minLng = b[0];
      if (b[2] > maxLng) maxLng = b[2];
      if (b[1] < minLat) minLat = b[1];
      if (b[3] > maxLat) maxLat = b[3];
    });
    var lngSpan = Math.max(maxLng - minLng, opts.minSpan) + opts.padding;
    var latSpan = Math.max(maxLat - minLat, opts.minSpan) + opts.padding;
    var zoom = Math.min(opts.fullLng / lngSpan, opts.fullLat / latSpan) * 1.05;
    zoom = Math.max(1.05, Math.min(zoom, opts.maxZoom));
    return { center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2], zoom: zoom };
  }

  function renderChart() {
    if (!chart) return;
    if (state.view === 'china') {
      renderChinaChart();
    } else {
      renderWorldChart();
    }
  }

  function renderChinaChart() {
    var visited = state.visitedByView.china;
    var visitedProvinces = {};
    visited.forEach(function (c) {
      visitedProvinces[c.province] = true;
    });

    var litRegionNames;
    if (state.mode === 'province') {
      litRegionNames = Object.keys(visitedProvinces);
    } else if (state.mode === 'city') {
      litRegionNames = visited.map(function (c) {
        return c.regionName;
      });
    } else {
      litRegionNames = [];
    }

    var regions = litRegionNames.map(function (regionName) {
      var region = {
        name: regionName,
        itemStyle: { areaColor: '#ffb37a' },
      };
      if (state.mode === 'city') {
        region.itemStyle.borderColor = '#e2571f';
        region.itemStyle.borderWidth = 1.5;
        region.label = {
          show: true,
          formatter: REGION_DISPLAY[regionName] || regionName,
          fontSize: 12,
          fontWeight: 600,
          color: '#e2571f',
        };
      }
      return region;
    });

    var provinceLabelData = PROVINCE_LABELS.map(function (p) {
      return { name: p.name, value: [p.lng, p.lat] };
    });

    var viewport =
      state.mode === 'city'
        ? computeViewport(visited, {
            minSpan: 6,
            padding: 3,
            fullLng: 62,
            fullLat: 51,
            maxZoom: 12,
          })
        : null;

    var option = {
      tooltip: {
        show: true,
        formatter: function (params) {
          return REGION_DISPLAY[params.name] || params.name;
        },
      },
      geo: {
        map: MODE_MAP[state.mode],
        roam: true,
        zoom: viewport ? viewport.zoom : 1.05,
        center: viewport ? viewport.center : null,
        label: { show: false },
        itemStyle: {
          areaColor: '#e6e8eb',
          borderColor: '#d3d6da',
          borderWidth: 0.6,
        },
        emphasis: {
          itemStyle: { areaColor: '#d8dade' },
          label: { show: false },
        },
        select: {
          itemStyle: { areaColor: '#d8dade' },
        },
        regions: regions,
      },
      series: [
        {
          name: '省份标注',
          type: 'scatter',
          coordinateSystem: 'geo',
          data: provinceLabelData,
          symbolSize: 2,
          itemStyle: { color: '#c3c7cc', opacity: 1 },
          silent: true,
          label: {
            show: true,
            formatter: '{b}',
            fontSize: 10,
            color: '#9aa0a8',
          },
          tooltip: { show: false },
        },
      ],
    };

    chart.setOption(option, { notMerge: true });
  }

  function renderWorldChart() {
    var visited = state.visitedByView.world;

    var regions = visited.map(function (country) {
      return {
        name: country.regionName,
        itemStyle: {
          areaColor: '#ffb37a',
          borderColor: '#e2571f',
          borderWidth: 1.2,
        },
        label: {
          show: true,
          formatter: country.name,
          fontSize: 12,
          fontWeight: 600,
          color: '#e2571f',
        },
      };
    });

    var viewport = computeViewport(visited, {
      bbox: function (c) {
        return c.bbox;
      },
      minSpan: 4,
      padding: 2,
      fullLng: 360,
      fullLat: 139,
      maxZoom: 40,
    });

    var option = {
      tooltip: {
        show: true,
        formatter: function (params) {
          return COUNTRY_DISPLAY[params.name] || params.name;
        },
      },
      geo: {
        map: 'world',
        roam: true,
        zoom: viewport ? viewport.zoom : 1.05,
        center: viewport ? viewport.center : null,
        label: { show: false },
        itemStyle: {
          areaColor: '#e6e8eb',
          borderColor: '#d3d6da',
          borderWidth: 0.6,
        },
        emphasis: {
          itemStyle: { areaColor: '#d8dade' },
          label: { show: false },
        },
        select: {
          itemStyle: { areaColor: '#d8dade' },
        },
        regions: regions,
      },
      series: [],
    };

    chart.setOption(option, { notMerge: true });
  }

  // ---------- View switch (China / World) ----------

  function setView(view) {
    if (VIEWS.indexOf(view) === -1 || view === state.view) return;
    state.view = view;
    localStorage.setItem(VIEW_STORAGE_KEY, view);
    updateViewButtons();
    applyDatasetLabels();
    clearSelection();
    els.searchInput.value = '';
    els.searchHint.textContent = '';
    els.suggestList.classList.add('hidden');
    renderVisitedList();
    renderStats();
    renderChart();
  }

  function updateViewButtons() {
    els.viewButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });
    els.chinaModeSwitch.style.display = state.view === 'china' ? 'flex' : 'none';
  }

  function applyDatasetLabels() {
    var d = dataset();
    els.searchPanelTitle.textContent = d.searchTitle;
    els.visitedPanelTitle.textContent = d.visitedTitle;
    els.searchInput.placeholder = d.searchPlaceholder;
    els.itemCountLabel.textContent = d.itemCountLabel;
    els.groupCountLabel.textContent = d.groupCountLabel;
  }

  els.viewButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setView(btn.dataset.view);
    });
  });

  updateViewButtons();
  applyDatasetLabels();

  // ---------- China mode switch ----------

  function setMode(mode) {
    if (MODES.indexOf(mode) === -1 || mode === state.mode) return;
    state.mode = mode;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    updateModeButtons();
    renderChart();
  }

  function updateModeButtons() {
    els.modeButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });
  }

  els.modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setMode(btn.dataset.mode);
    });
  });

  updateModeButtons();

  // ---------- Search & suggestions ----------

  function searchItems(query) {
    query = query.trim();
    if (!query) return [];
    var groupField = dataset().groupField;
    return dataset()
      .list.filter(function (item) {
        return (
          item.name.indexOf(query) !== -1 ||
          item[groupField].indexOf(query) !== -1
        );
      })
      .slice(0, 8);
  }

  function renderSuggestions(list) {
    state.currentSuggestions = list;
    state.activeSuggestIndex = list.length ? 0 : -1;
    els.suggestList.innerHTML = '';

    if (!list.length) {
      els.suggestList.classList.add('hidden');
      return;
    }

    var groupField = dataset().groupField;

    list.forEach(function (item, idx) {
      var el = document.createElement('div');
      el.className = 'suggest-item' + (idx === 0 ? ' active' : '');
      if (isVisited(item)) el.classList.add('visited-mark');

      var nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      var groupSpan = document.createElement('span');
      groupSpan.className = 'province';
      groupSpan.textContent = item[groupField];

      el.appendChild(nameSpan);
      el.appendChild(groupSpan);
      el.addEventListener('click', function () {
        selectItem(item);
      });

      els.suggestList.appendChild(el);
    });

    els.suggestList.classList.remove('hidden');
  }

  function selectItem(item) {
    state.selectedItem = item;
    els.searchInput.value = item.name;
    els.suggestList.classList.add('hidden');
    els.confirmBtn.disabled = false;
    els.searchHint.textContent = isVisited(item)
      ? item.name + ' 已在到访列表中'
      : '已选择「' + item.name + '」，点击确认添加';
  }

  function clearSelection() {
    state.selectedItem = null;
    els.confirmBtn.disabled = true;
  }

  els.searchInput.addEventListener('input', function () {
    clearSelection();
    var query = els.searchInput.value;
    var results = searchItems(query);
    renderSuggestions(results);
    els.searchHint.textContent = '';
  });

  els.searchInput.addEventListener('keydown', function (e) {
    var list = state.currentSuggestions;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!list.length) return;
      state.activeSuggestIndex = (state.activeSuggestIndex + 1) % list.length;
      updateActiveSuggestItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list.length) return;
      state.activeSuggestIndex =
        (state.activeSuggestIndex - 1 + list.length) % list.length;
      updateActiveSuggestItem();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.activeSuggestIndex >= 0 && list[state.activeSuggestIndex]) {
        selectItem(list[state.activeSuggestIndex]);
      } else if (state.selectedItem) {
        addVisitedItem(state.selectedItem);
      }
    } else if (e.key === 'Escape') {
      els.suggestList.classList.add('hidden');
    }
  });

  function updateActiveSuggestItem() {
    var items = els.suggestList.querySelectorAll('.suggest-item');
    items.forEach(function (item, idx) {
      item.classList.toggle('active', idx === state.activeSuggestIndex);
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search-box')) {
      els.suggestList.classList.add('hidden');
    }
  });

  els.confirmBtn.addEventListener('click', function () {
    if (state.selectedItem) {
      addVisitedItem(state.selectedItem);
    }
  });

  // ---------- Visited management ----------

  function addVisitedItem(item) {
    if (isVisited(item)) {
      els.searchHint.textContent = item.name + ' 已在到访列表中';
      return;
    }
    visitedList().push(item);
    saveVisited();
    renderVisitedList();
    renderStats();
    renderChart();

    els.searchHint.textContent = '已添加「' + item.name + '」';
    els.searchInput.value = '';
    clearSelection();
    els.suggestList.classList.add('hidden');
  }

  function removeVisitedItem(item) {
    var key = itemKey(state.view, item);
    state.visitedByView[state.view] = visitedList().filter(function (v) {
      return itemKey(state.view, v) !== key;
    });
    saveVisited();
    renderVisitedList();
    renderStats();
    renderChart();
  }

  function renderVisitedList() {
    els.visitedList.innerHTML = '';
    var d = dataset();
    var visited = visitedList();

    if (!visited.length) {
      var empty = document.createElement('li');
      empty.className = 'empty-tip';
      empty.textContent = d.emptyText;
      els.visitedList.appendChild(empty);
      return;
    }

    visited
      .slice()
      .sort(function (a, b) {
        return a[d.groupField].localeCompare(b[d.groupField], 'zh');
      })
      .forEach(function (item) {
        var li = document.createElement('li');

        var left = document.createElement('span');
        var nameSpan = document.createElement('span');
        nameSpan.className = 'city-name';
        nameSpan.textContent = item.name;
        var groupSpan = document.createElement('span');
        groupSpan.className = 'city-province';
        groupSpan.textContent = item[d.groupField];
        left.appendChild(nameSpan);
        left.appendChild(groupSpan);

        var removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', '移除 ' + item.name);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', function () {
          removeVisitedItem(item);
        });

        li.appendChild(left);
        li.appendChild(removeBtn);
        els.visitedList.appendChild(li);
      });
  }

  function renderStats() {
    var d = dataset();
    var visited = visitedList();
    els.itemCount.textContent = visited.length;
    var groups = {};
    visited.forEach(function (item) {
      groups[item[d.groupField]] = true;
    });
    els.groupCount.textContent = Object.keys(groups).length;
  }

  // ---------- Init ----------

  initChart();
  renderVisitedList();
  renderStats();
})();
