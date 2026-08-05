(function () {
  'use strict';

  var STORAGE_KEY = 'visitedCities';
  var MODE_STORAGE_KEY = 'mapMode';
  var PROVINCE_GEOJSON_URL = 'data/china.json';
  var CITY_GEOJSON_URL = 'data/china-cities.json';
  var MODES = ['off', 'province', 'city'];
  // Which registered map + granularity of highlighting each mode uses.
  var MODE_MAP = { off: 'china', province: 'china', city: 'china-cities' };

  // regionName -> display name, for tooltips over the city-level map.
  var REGION_DISPLAY = {};
  CITIES.forEach(function (c) {
    REGION_DISPLAY[c.regionName] = c.name;
  });

  var state = {
    mode: loadMode(),
    visited: loadVisited(),
    selectedCity: null,
    activeSuggestIndex: -1,
    currentSuggestions: [],
  };

  var chart = null;

  var els = {
    mapContainer: document.getElementById('mapContainer'),
    mapLoading: document.getElementById('mapLoading'),
    modeButtons: document.querySelectorAll('.mode-btn'),
    searchInput: document.getElementById('citySearchInput'),
    suggestList: document.getElementById('suggestList'),
    confirmBtn: document.getElementById('confirmAddBtn'),
    searchHint: document.getElementById('searchHint'),
    cityCount: document.getElementById('cityCount'),
    provinceCount: document.getElementById('provinceCount'),
    visitedList: document.getElementById('visitedList'),
  };

  function loadVisited() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveVisited() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.visited));
  }

  function loadMode() {
    var saved = localStorage.getItem(MODE_STORAGE_KEY);
    return MODES.indexOf(saved) !== -1 ? saved : 'off';
  }

  function cityKey(city) {
    return city.name + '|' + city.province;
  }

  function isVisited(city) {
    var key = cityKey(city);
    return state.visited.some(function (c) {
      return cityKey(c) === key;
    });
  }

  // ---------- Map ----------

  function initChart() {
    chart = echarts.init(els.mapContainer);
    window.addEventListener('resize', function () {
      chart.resize();
    });

    function loadMap(url) {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('geojson fetch failed: ' + res.status);
        return res.json();
      });
    }

    Promise.all([loadMap(PROVINCE_GEOJSON_URL), loadMap(CITY_GEOJSON_URL)])
      .then(function (results) {
        echarts.registerMap('china', results[0]);
        echarts.registerMap('china-cities', results[1]);
        els.mapLoading.style.display = 'none';
        renderChart();
      })
      .catch(function (err) {
        els.mapLoading.textContent = '地图加载失败，请检查网络后刷新页面';
        console.error(err);
      });
  }

  function renderChart() {
    if (!chart) return;

    var showCityMarkers = state.mode === 'city';

    var visitedProvinces = {};
    state.visited.forEach(function (c) {
      visitedProvinces[c.province] = true;
    });

    var litRegionNames;
    if (state.mode === 'province') {
      litRegionNames = Object.keys(visitedProvinces);
    } else if (state.mode === 'city') {
      litRegionNames = state.visited.map(function (c) {
        return c.regionName;
      });
    } else {
      litRegionNames = [];
    }

    var regions = litRegionNames.map(function (regionName) {
      return {
        name: regionName,
        itemStyle: { areaColor: '#ffb37a' },
      };
    });

    var scatterData = showCityMarkers
      ? state.visited.map(function (c) {
          return {
            name: c.name,
            value: [c.lng, c.lat],
          };
        })
      : [];

    var provinceLabelData = PROVINCE_LABELS.map(function (p) {
      return { name: p.name, value: [p.lng, p.lat] };
    });

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
        zoom: 1.05,
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
        {
          name: '到访城市',
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: scatterData,
          symbolSize: 9,
          showEffectOn: 'render',
          rippleEffect: { brushType: 'stroke', scale: 3.5, period: 3 },
          itemStyle: {
            color: '#ff6b35',
            shadowBlur: 12,
            shadowColor: 'rgba(255, 107, 53, 0.8)',
          },
          label: {
            show: true,
            formatter: '{b}',
            position: 'right',
            fontSize: 11,
            fontWeight: 600,
            color: '#e2571f',
          },
          zlevel: 1,
        },
      ],
    };

    chart.setOption(option, { notMerge: true });
  }

  // ---------- Mode switch ----------

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

  function searchCities(query) {
    query = query.trim();
    if (!query) return [];
    return CITIES.filter(function (c) {
      return c.name.indexOf(query) !== -1 || c.province.indexOf(query) !== -1;
    }).slice(0, 8);
  }

  function renderSuggestions(list) {
    state.currentSuggestions = list;
    state.activeSuggestIndex = list.length ? 0 : -1;
    els.suggestList.innerHTML = '';

    if (!list.length) {
      els.suggestList.classList.add('hidden');
      return;
    }

    list.forEach(function (city, idx) {
      var item = document.createElement('div');
      item.className = 'suggest-item' + (idx === 0 ? ' active' : '');
      if (isVisited(city)) item.classList.add('visited-mark');

      var nameSpan = document.createElement('span');
      nameSpan.textContent = city.name;
      var provinceSpan = document.createElement('span');
      provinceSpan.className = 'province';
      provinceSpan.textContent = city.province;

      item.appendChild(nameSpan);
      item.appendChild(provinceSpan);
      item.addEventListener('click', function () {
        selectCity(city);
      });

      els.suggestList.appendChild(item);
    });

    els.suggestList.classList.remove('hidden');
  }

  function selectCity(city) {
    state.selectedCity = city;
    els.searchInput.value = city.name;
    els.suggestList.classList.add('hidden');
    els.confirmBtn.disabled = false;
    els.searchHint.textContent = isVisited(city)
      ? city.name + ' 已在到访列表中'
      : '已选择「' + city.name + '」，点击确认添加';
  }

  function clearSelection() {
    state.selectedCity = null;
    els.confirmBtn.disabled = true;
  }

  els.searchInput.addEventListener('input', function () {
    clearSelection();
    var query = els.searchInput.value;
    var results = searchCities(query);
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
        selectCity(list[state.activeSuggestIndex]);
      } else if (state.selectedCity) {
        addVisitedCity(state.selectedCity);
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
    if (state.selectedCity) {
      addVisitedCity(state.selectedCity);
    }
  });

  // ---------- Visited management ----------

  function addVisitedCity(city) {
    if (isVisited(city)) {
      els.searchHint.textContent = city.name + ' 已在到访列表中';
      return;
    }
    state.visited.push(city);
    saveVisited();
    renderVisitedList();
    renderStats();
    renderChart();

    els.searchHint.textContent = '已添加「' + city.name + '」';
    els.searchInput.value = '';
    clearSelection();
    els.suggestList.classList.add('hidden');
  }

  function removeVisitedCity(city) {
    var key = cityKey(city);
    state.visited = state.visited.filter(function (c) {
      return cityKey(c) !== key;
    });
    saveVisited();
    renderVisitedList();
    renderStats();
    renderChart();
  }

  function renderVisitedList() {
    els.visitedList.innerHTML = '';

    if (!state.visited.length) {
      var empty = document.createElement('li');
      empty.className = 'empty-tip';
      empty.textContent = '还没有添加城市，快去点亮地图吧～';
      els.visitedList.appendChild(empty);
      return;
    }

    state.visited
      .slice()
      .sort(function (a, b) {
        return a.province.localeCompare(b.province, 'zh');
      })
      .forEach(function (city) {
        var li = document.createElement('li');

        var left = document.createElement('span');
        var nameSpan = document.createElement('span');
        nameSpan.className = 'city-name';
        nameSpan.textContent = city.name;
        var provinceSpan = document.createElement('span');
        provinceSpan.className = 'city-province';
        provinceSpan.textContent = city.province;
        left.appendChild(nameSpan);
        left.appendChild(provinceSpan);

        var removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', '移除 ' + city.name);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', function () {
          removeVisitedCity(city);
        });

        li.appendChild(left);
        li.appendChild(removeBtn);
        els.visitedList.appendChild(li);
      });
  }

  function renderStats() {
    els.cityCount.textContent = state.visited.length;
    var provinces = {};
    state.visited.forEach(function (c) {
      provinces[c.province] = true;
    });
    els.provinceCount.textContent = Object.keys(provinces).length;
  }

  // ---------- Init ----------

  initChart();
  renderVisitedList();
  renderStats();
})();
