(function () {
  'use strict';

  var CHINA_STORAGE_KEY = 'visitedCities';
  var WORLD_STORAGE_KEY = 'visitedCountries';
  var VIEW_STORAGE_KEY = 'mapView';
  var MODE_STORAGE_KEY = 'mapMode';
  var MEMBER_STORAGE_KEY = 'travelMembers';
  var ACTIVE_MEMBER_STORAGE_KEY = 'activeMemberId';
  var MEMBER_COLORS = [
    '#ff6b35',
    '#3b82f6',
    '#22a06b',
    '#a855f7',
    '#e0367f',
    '#14b8a6',
    '#eab308',
    '#ef4444',
  ];
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

  var COUNTRY_DISPLAY = {
    // 世界地图数据里台湾、香港是独立于中国大陆的边界要素，单独给出中文名，
    // 避免鼠标悬停时显示原始的 ISO 代码。
    TWN: '中国台湾',
    HKG: '中国香港',
  };
  var REGION_TO_COUNTRY = {};
  COUNTRIES.forEach(function (c) {
    COUNTRY_DISPLAY[c.regionName] = c.name;
    REGION_TO_COUNTRY[c.regionName] = c;
  });

  var state = {
    view: loadView(),
    mode: loadMode(),
    members: loadMembers(),
    activeMemberId: null,
    visitedByMember: {},
    selectedItem: null,
    activeSuggestIndex: -1,
    currentSuggestions: [],
    auth: { user: null },
  };
  state.activeMemberId = loadActiveMemberId(state.members);
  state.members.forEach(function (m) {
    state.visitedByMember[m.id] = {
      china: loadVisited(m.id, 'china'),
      world: loadVisited(m.id, 'world'),
    };
  });

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
    memberSwitch: document.getElementById('memberSwitch'),
    memberModalOverlay: document.getElementById('memberModalOverlay'),
    memberModalCloseBtn: document.getElementById('memberModalCloseBtn'),
    memberManageList: document.getElementById('memberManageList'),
    newMemberNameInput: document.getElementById('newMemberNameInput'),
    newMemberAddBtn: document.getElementById('newMemberAddBtn'),
    authOpenBtn: document.getElementById('authOpenBtn'),
    authStatus: document.getElementById('authStatus'),
    authEmail: document.getElementById('authEmail'),
    authLogoutBtn: document.getElementById('authLogoutBtn'),
    authModalOverlay: document.getElementById('authModalOverlay'),
    authCloseBtn: document.getElementById('authCloseBtn'),
    authEmailInput: document.getElementById('authEmailInput'),
    authPasswordInput: document.getElementById('authPasswordInput'),
    authLoginBtn: document.getElementById('authLoginBtn'),
    authSignupBtn: document.getElementById('authSignupBtn'),
    authMessage: document.getElementById('authMessage'),
  };

  function dataset() {
    return DATASETS[state.view];
  }

  function visitedList() {
    return state.visitedByMember[state.activeMemberId][state.view];
  }

  function memberStorageKey(baseKey, memberId) {
    return baseKey + '::' + memberId;
  }

  function loadVisited(memberId, view) {
    try {
      var raw = localStorage.getItem(memberStorageKey(DATASETS[view].storageKey, memberId));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveVisited() {
    localStorage.setItem(
      memberStorageKey(dataset().storageKey, state.activeMemberId),
      JSON.stringify(visitedList())
    );
  }

  // ---------- Members ----------

  function nextMemberColor(members) {
    var used = {};
    members.forEach(function (m) {
      used[m.color] = true;
    });
    for (var i = 0; i < MEMBER_COLORS.length; i++) {
      if (!used[MEMBER_COLORS[i]]) return MEMBER_COLORS[i];
    }
    return MEMBER_COLORS[members.length % MEMBER_COLORS.length];
  }

  // First run / upgrade from the single-user version: create a default
  // member and migrate any pre-existing flat visited-data into it so
  // nobody's history disappears when this feature ships.
  function loadMembers() {
    try {
      var raw = localStorage.getItem(MEMBER_STORAGE_KEY);
      if (raw) {
        var members = JSON.parse(raw);
        if (members && members.length) return members;
      }
    } catch (e) {}

    var defaultMember = { id: 'm' + Date.now(), name: '我', color: MEMBER_COLORS[0] };
    try {
      var legacyCities = localStorage.getItem(CHINA_STORAGE_KEY);
      var legacyCountries = localStorage.getItem(WORLD_STORAGE_KEY);
      if (legacyCities) {
        localStorage.setItem(memberStorageKey(CHINA_STORAGE_KEY, defaultMember.id), legacyCities);
      }
      if (legacyCountries) {
        localStorage.setItem(memberStorageKey(WORLD_STORAGE_KEY, defaultMember.id), legacyCountries);
      }
    } catch (e) {}

    localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify([defaultMember]));
    return [defaultMember];
  }

  function loadActiveMemberId(members) {
    var saved = localStorage.getItem(ACTIVE_MEMBER_STORAGE_KEY);
    if (
      saved &&
      members.some(function (m) {
        return m.id === saved;
      })
    ) {
      return saved;
    }
    return members[0].id;
  }

  function persistMembers() {
    localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify(state.members));
    localStorage.setItem(ACTIVE_MEMBER_STORAGE_KEY, state.activeMemberId);
  }

  function activeMember() {
    var found = null;
    state.members.forEach(function (m) {
      if (m.id === state.activeMemberId) found = m;
    });
    return found || state.members[0];
  }

  function setActiveMember(memberId) {
    if (memberId === state.activeMemberId) return;
    if (
      !state.members.some(function (m) {
        return m.id === memberId;
      })
    ) {
      return;
    }
    state.activeMemberId = memberId;
    persistMembers();
    updateMemberSwitchUI();
    clearSelection();
    els.searchInput.value = '';
    els.searchHint.textContent = '';
    els.suggestList.classList.add('hidden');
    renderVisitedList();
    renderStats();
    renderChart();
  }

  function addMember(name) {
    name = (name || '').trim();
    if (!name) return;
    var member = { id: 'm' + Date.now(), name: name, color: nextMemberColor(state.members) };
    state.members.push(member);
    state.visitedByMember[member.id] = { china: [], world: [] };
    state.activeMemberId = member.id;
    persistMembers();
    updateMemberSwitchUI();
    renderMemberManageList();
    clearSelection();
    renderVisitedList();
    renderStats();
    renderChart();
    if (isLoggedIn()) pushLocalToCloud();
  }

  function renameMember(memberId, name) {
    name = (name || '').trim();
    if (!name) return;
    var member = null;
    state.members.forEach(function (m) {
      if (m.id === memberId) member = m;
    });
    if (!member || member.name === name) return;
    member.name = name;
    persistMembers();
    updateMemberSwitchUI();
    if (isLoggedIn()) pushLocalToCloud();
  }

  function cycleMemberColor(memberId) {
    var member = null;
    state.members.forEach(function (m) {
      if (m.id === memberId) member = m;
    });
    if (!member) return;
    var idx = MEMBER_COLORS.indexOf(member.color);
    member.color = MEMBER_COLORS[(idx + 1) % MEMBER_COLORS.length];
    persistMembers();
    updateMemberSwitchUI();
    renderMemberManageList();
    if (member.id === state.activeMemberId) renderChart();
    if (isLoggedIn()) pushLocalToCloud();
  }

  function deleteMember(memberId) {
    if (state.members.length <= 1) return;
    var member = null;
    state.members.forEach(function (m) {
      if (m.id === memberId) member = m;
    });
    if (!member) return;
    var ok = window.confirm('确定要删除成员「' + member.name + '」吗？该成员的到访记录也会被删除。');
    if (!ok) return;

    state.members = state.members.filter(function (m) {
      return m.id !== memberId;
    });
    delete state.visitedByMember[memberId];
    localStorage.removeItem(memberStorageKey(CHINA_STORAGE_KEY, memberId));
    localStorage.removeItem(memberStorageKey(WORLD_STORAGE_KEY, memberId));
    if (state.activeMemberId === memberId) {
      state.activeMemberId = state.members[0].id;
    }
    persistMembers();
    updateMemberSwitchUI();
    renderMemberManageList();
    renderVisitedList();
    renderStats();
    renderChart();
    if (isLoggedIn()) pushLocalToCloud();
  }

  function updateMemberSwitchUI() {
    els.memberSwitch.innerHTML = '';
    state.members.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'member-pill' + (m.id === state.activeMemberId ? ' active' : '');

      var dot = document.createElement('span');
      dot.className = 'member-color-dot';
      dot.style.background = m.color;

      var label = document.createElement('span');
      label.textContent = m.name;

      btn.appendChild(dot);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        setActiveMember(m.id);
      });
      els.memberSwitch.appendChild(btn);
    });

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'member-add-btn';
    addBtn.title = '管理成员';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', openMemberModal);
    els.memberSwitch.appendChild(addBtn);
  }

  function renderMemberManageList() {
    els.memberManageList.innerHTML = '';
    state.members.forEach(function (m) {
      var li = document.createElement('li');

      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'member-color-dot';
      dot.style.background = m.color;
      dot.title = '点击更换颜色';
      dot.addEventListener('click', function () {
        cycleMemberColor(m.id);
      });

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'member-name-input';
      input.value = m.name;
      input.addEventListener('change', function () {
        renameMember(m.id, input.value);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'member-delete-btn';
      delBtn.textContent = '×';
      delBtn.disabled = state.members.length <= 1;
      delBtn.setAttribute('aria-label', '删除 ' + m.name);
      delBtn.addEventListener('click', function () {
        deleteMember(m.id);
      });

      li.appendChild(dot);
      li.appendChild(input);
      li.appendChild(delBtn);
      els.memberManageList.appendChild(li);
    });
  }

  function openMemberModal() {
    renderMemberManageList();
    els.newMemberNameInput.value = '';
    els.memberModalOverlay.classList.remove('hidden');
  }

  function closeMemberModal() {
    els.memberModalOverlay.classList.add('hidden');
  }

  els.memberModalCloseBtn.addEventListener('click', closeMemberModal);
  els.memberModalOverlay.addEventListener('click', function (e) {
    if (e.target === els.memberModalOverlay) closeMemberModal();
  });
  els.newMemberAddBtn.addEventListener('click', function () {
    addMember(els.newMemberNameInput.value);
    els.newMemberNameInput.value = '';
  });
  els.newMemberNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.newMemberAddBtn.click();
  });

  // Lighten (positive percent) or darken (negative percent) a hex color,
  // used to derive a highlight fill/border pair from a member's base color.
  function shadeColor(hex, percent) {
    var num = parseInt(hex.slice(1), 16);
    var r = (num >> 16) + Math.round(255 * percent);
    var g = ((num >> 8) & 0xff) + Math.round(255 * percent);
    var b = (num & 0xff) + Math.round(255 * percent);
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
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
    var member = activeMember();
    var fillColor = shadeColor(member.color, 0.45);
    var borderColor = shadeColor(member.color, -0.1);
    var visited = state.visitedByMember[state.activeMemberId].china;
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
        itemStyle: { areaColor: fillColor },
      };
      if (state.mode === 'city') {
        region.itemStyle.borderColor = borderColor;
        region.itemStyle.borderWidth = 1.5;
        region.label = {
          show: true,
          formatter: REGION_DISPLAY[regionName] || regionName,
          fontSize: 12,
          fontWeight: 600,
          color: borderColor,
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
      tooltip: { show: true },
      geo: {
        map: MODE_MAP[state.mode],
        roam: true,
        zoom: viewport ? viewport.zoom : 1.05,
        center: viewport ? viewport.center : null,
        label: { show: false },
        tooltip: {
          formatter: function (params) {
            return REGION_DISPLAY[params.name] || params.name;
          },
        },
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

  // 台湾、香港是中国领土不可分割的一部分：世界地图数据里它们是独立的
  // 边界要素，点亮中国时一并点亮，避免地图上看起来像是没被点亮的样子。
  var CHINA_AUX_REGIONS = ['TWN', 'HKG'];

  function renderWorldChart() {
    var member = activeMember();
    var fillColor = shadeColor(member.color, 0.45);
    var borderColor = shadeColor(member.color, -0.1);
    var visited = state.visitedByMember[state.activeMemberId].world;

    var regions = [];
    visited.forEach(function (country) {
      regions.push({
        name: country.regionName,
        itemStyle: {
          areaColor: fillColor,
          borderColor: borderColor,
          borderWidth: 1.2,
        },
        label: {
          show: true,
          formatter: country.name,
          fontSize: 12,
          fontWeight: 600,
          color: borderColor,
        },
      });
      if (country.regionName === 'CHN') {
        CHINA_AUX_REGIONS.forEach(function (auxName) {
          regions.push({
            name: auxName,
            itemStyle: {
              areaColor: fillColor,
              borderColor: borderColor,
              borderWidth: 1.2,
            },
          });
        });
      }
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
      tooltip: { show: true },
      geo: {
        map: 'world',
        roam: true,
        zoom: viewport ? viewport.zoom : 1.05,
        center: viewport ? viewport.center : null,
        label: { show: false },
        tooltip: {
          formatter: function (params) {
            return COUNTRY_DISPLAY[params.name] || params.name;
          },
        },
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
    if (isLoggedIn()) pushLocalToCloud();

    els.searchHint.textContent = '已添加「' + item.name + '」';
    els.searchInput.value = '';
    clearSelection();
    els.suggestList.classList.add('hidden');
  }

  function removeVisitedItem(item) {
    var key = itemKey(state.view, item);
    state.visitedByMember[state.activeMemberId][state.view] = visitedList().filter(function (v) {
      return itemKey(state.view, v) !== key;
    });
    saveVisited();
    renderVisitedList();
    renderStats();
    renderChart();
    if (isLoggedIn()) pushLocalToCloud();
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

  // ---------- Auth & cloud sync ----------

  var CLOUD_TABLE = 'travel_data';

  function isLoggedIn() {
    return !!state.auth.user;
  }

  function setAuthMessage(text, type) {
    els.authMessage.textContent = text || '';
    els.authMessage.className = 'auth-message' + (type ? ' ' + type : '');
  }

  function openAuthModal() {
    setAuthMessage('');
    els.authModalOverlay.classList.remove('hidden');
  }

  function closeAuthModal() {
    els.authModalOverlay.classList.add('hidden');
  }

  function updateAuthUI() {
    if (isLoggedIn()) {
      els.authOpenBtn.classList.add('hidden');
      els.authStatus.classList.remove('hidden');
      els.authEmail.textContent = state.auth.user.email;
    } else {
      els.authOpenBtn.classList.remove('hidden');
      els.authStatus.classList.add('hidden');
      els.authEmail.textContent = '';
    }
  }

  function fetchCloudRow() {
    if (!supabaseClient || !isLoggedIn()) return Promise.resolve(null);
    return supabaseClient
      .from(CLOUD_TABLE)
      .select('members, visited_cities, visited_countries')
      .eq('user_id', state.auth.user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) {
          console.error('load cloud data failed', res.error);
          return null;
        }
        return res.data;
      });
  }

  function serializeMembers() {
    return state.members.map(function (m) {
      return {
        id: m.id,
        name: m.name,
        color: m.color,
        visitedCities: state.visitedByMember[m.id].china,
        visitedCountries: state.visitedByMember[m.id].world,
      };
    });
  }

  function pushLocalToCloud() {
    if (!supabaseClient || !isLoggedIn()) return Promise.resolve();
    return supabaseClient
      .from(CLOUD_TABLE)
      .upsert({
        user_id: state.auth.user.id,
        members: serializeMembers(),
        updated_at: new Date().toISOString(),
      })
      .then(function (res) {
        if (res.error) console.error('sync to cloud failed', res.error);
      });
  }

  // Cloud rows written before multi-member support only have the old flat
  // visited_cities/visited_countries columns; wrap those into a single
  // default member so existing accounts don't lose their history.
  function membersFromCloudRow(row) {
    if (row && row.members && row.members.length) return row.members;
    if (row && (row.visited_cities || row.visited_countries)) {
      return [
        {
          id: 'm' + Date.now(),
          name: '我',
          color: MEMBER_COLORS[0],
          visitedCities: row.visited_cities || [],
          visitedCountries: row.visited_countries || [],
        },
      ];
    }
    return [{ id: 'm' + Date.now(), name: '我', color: MEMBER_COLORS[0], visitedCities: [], visitedCountries: [] }];
  }

  function applyCloudRow(row) {
    var members = membersFromCloudRow(row);
    state.members = members.map(function (m) {
      return { id: m.id, name: m.name, color: m.color };
    });
    state.visitedByMember = {};
    members.forEach(function (m) {
      state.visitedByMember[m.id] = {
        china: m.visitedCities || [],
        world: m.visitedCountries || [],
      };
      localStorage.setItem(memberStorageKey(CHINA_STORAGE_KEY, m.id), JSON.stringify(m.visitedCities || []));
      localStorage.setItem(memberStorageKey(WORLD_STORAGE_KEY, m.id), JSON.stringify(m.visitedCountries || []));
    });
    state.activeMemberId = state.members[0].id;
    persistMembers();
    updateMemberSwitchUI();
    renderVisitedList();
    renderStats();
    renderChart();
  }

  // Decide how to reconcile whatever is on this device (guest/local data)
  // with whatever is already saved in the cloud for the account that just
  // logged in, so neither side silently loses data.
  function reconcileAfterLogin() {
    fetchCloudRow().then(function (row) {
      var localHasData = state.members.some(function (m) {
        var v = state.visitedByMember[m.id];
        return v.china.length > 0 || v.world.length > 0;
      });
      var cloudHasData =
        row &&
        ((row.members &&
          row.members.some(function (m) {
            return (m.visitedCities && m.visitedCities.length > 0) || (m.visitedCountries && m.visitedCountries.length > 0);
          })) ||
          (row.visited_cities && row.visited_cities.length > 0) ||
          (row.visited_countries && row.visited_countries.length > 0));

      if (!cloudHasData) {
        pushLocalToCloud();
        return;
      }
      if (!localHasData) {
        applyCloudRow(row);
        return;
      }
      var useCloud = window.confirm(
        '本机有尚未同步的到访记录，云端也已保存有数据。\n' +
          '点击"确定"使用云端数据（本机未同步的记录会被覆盖）；\n' +
          '点击"取消"保留本机数据并覆盖云端。'
      );
      if (useCloud) {
        applyCloudRow(row);
      } else {
        pushLocalToCloud();
      }
    });
  }

  els.authOpenBtn.addEventListener('click', openAuthModal);
  els.authCloseBtn.addEventListener('click', closeAuthModal);
  els.authModalOverlay.addEventListener('click', function (e) {
    if (e.target === els.authModalOverlay) closeAuthModal();
  });

  els.authLogoutBtn.addEventListener('click', function () {
    if (!supabaseClient) return;
    supabaseClient.auth.signOut();
  });

  function requireAuthForm() {
    if (!supabaseClient) {
      setAuthMessage('云端存储未配置。', 'error');
      return null;
    }
    var email = els.authEmailInput.value.trim();
    var password = els.authPasswordInput.value;
    if (!email || !password) {
      setAuthMessage('请输入邮箱和密码', 'error');
      return null;
    }
    return { email: email, password: password };
  }

  els.authLoginBtn.addEventListener('click', function () {
    var form = requireAuthForm();
    if (!form) return;
    setAuthMessage('登录中…');
    supabaseClient.auth.signInWithPassword(form).then(function (res) {
      if (res.error) {
        setAuthMessage(res.error.message, 'error');
        return;
      }
      setAuthMessage('登录成功', 'success');
      setTimeout(closeAuthModal, 600);
    });
  });

  els.authSignupBtn.addEventListener('click', function () {
    var form = requireAuthForm();
    if (!form) return;
    if (form.password.length < 6) {
      setAuthMessage('密码至少需要 6 位', 'error');
      return;
    }
    setAuthMessage('注册中…');
    supabaseClient.auth.signUp(form).then(function (res) {
      if (res.error) {
        setAuthMessage(res.error.message, 'error');
        return;
      }
      if (res.data && res.data.user && !res.data.session) {
        setAuthMessage('注册成功，请查收邮箱并点击确认链接后再登录。', 'success');
        return;
      }
      setAuthMessage('注册成功并已登录', 'success');
      setTimeout(closeAuthModal, 600);
    });
  });

  els.authPasswordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.authLoginBtn.click();
  });

  function initAuth() {
    if (!supabaseClient) return;
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      var wasLoggedIn = isLoggedIn();
      state.auth.user = session ? session.user : null;
      updateAuthUI();
      if (!wasLoggedIn && state.auth.user) {
        reconcileAfterLogin();
      }
    });
  }

  // ---------- Init ----------

  updateMemberSwitchUI();
  initChart();
  renderVisitedList();
  renderStats();
  initAuth();
})();
