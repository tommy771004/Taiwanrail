/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Heart, Bell, Globe, ArrowRightLeft, Calendar, User, Search, CheckCircle, AlertCircle, XCircle, ChevronDown, AlertTriangle, Train, Sun, CloudRain } from 'lucide-react';

export default function App() {
  const [transportType, setTransportType] = useState<'hsr' | 'train'>('hsr');
  const [tripType, setTripType] = useState<'one-way' | 'round-trip'>('one-way');
  const [selectedDate, setSelectedDate] = useState('today');
  const [activeFilter, setActiveFilter] = useState('fastest');
  const [expandedTrainId, setExpandedTrainId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 1200);
    return () => clearTimeout(timer);
  }, [activeFilter, selectedDate, transportType, tripType]);

  const dates = [
    { id: 'today', label: '今天', date: '10月24日' },
    { id: 'tomorrow', label: '明天', date: '10月25日' },
    { id: 'd3', label: '週六', date: '10月26日' },
    { id: 'd4', label: '週日', date: '10月27日' },
    { id: 'd5', label: '週一', date: '10月28日' },
    { id: 'd6', label: '週二', date: '10月29日' },
    { id: 'd7', label: '週三', date: '10月30日' },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans text-slate-900 selection:bg-slate-200">
      {/* Navbar - Glassmorphism */}
      <header className="fixed top-0 w-full z-50 backdrop-blur-xl bg-white/30 border-b border-white/20 shadow-[0_4px_30px_rgba(0,0,0,0.03)]">
        <div className="max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between">
          <div className="text-xl font-semibold tracking-tight text-slate-800">
            Taiwan Rail Tracker
          </div>
          <div className="flex items-center gap-6 text-slate-600">
            <button className="hover:text-slate-900 transition-colors"><Heart className="w-5 h-5 stroke-[1.5]" /></button>
            <button className="hover:text-slate-900 transition-colors"><Bell className="w-5 h-5 stroke-[1.5]" /></button>
            <button className="hover:text-slate-900 transition-colors"><Globe className="w-5 h-5 stroke-[1.5]" /></button>
          </div>
        </div>
      </header>

      {/* Global Disruption Banner */}
      <div className="fixed top-20 w-full z-40 bg-amber-400 text-amber-950 px-4 py-3 shadow-md overflow-hidden">
        {/* Striped background pattern */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 10px, #000 10px, #000 20px)' }}></div>
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-3 relative z-10 text-sm font-bold tracking-wide cursor-pointer hover:opacity-80 transition-opacity">
          <AlertTriangle className="w-5 h-5 animate-pulse" />
          <span>東部幹線受地震影響，部分列車延誤或停駛，點此查看詳情</span>
        </div>
      </div>

      {/* Hero Section */}
      <section className="relative pt-40 pb-32 px-4 md:px-8 flex flex-col items-center justify-center min-h-[85vh]">
        {/* Background Image with Soft Blur */}
        <div className="absolute top-0 left-0 w-full h-[75vh] z-0 overflow-hidden">
          <img 
            src="https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?q=80&w=2070&auto=format&fit=crop" 
            alt="Modern Train Landscape" 
            className="w-full h-full object-cover object-center blur-lg scale-110 opacity-80"
            referrerPolicy="no-referrer"
          />
          {/* Gradient fade to off-white bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-[#F8F9FA]/80 to-[#F8F9FA]"></div>
        </div>

        {/* Search Card - Floating, Soft Shadow, White, Rounded */}
        <div className="relative z-10 w-full max-w-6xl bg-white rounded-[2.5rem] shadow-[0_20px_80px_-15px_rgba(0,0,0,0.08)] p-8 md:p-14">
          
          {/* Top Controls: Transport Type & Trip Type */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-12">
            {/* Transport Type Toggle */}
            <div className="flex p-1.5 bg-slate-50 rounded-full w-fit">
              <button 
                onClick={() => setTransportType('hsr')}
                className={`px-8 py-3 rounded-full text-sm font-medium transition-all duration-300 ${transportType === 'hsr' ? 'bg-white text-slate-900 shadow-[0_2px_10px_rgba(0,0,0,0.04)]' : 'text-slate-400 hover:text-slate-600'}`}
              >
                High Speed Rail
              </button>
              <button 
                onClick={() => setTransportType('train')}
                className={`px-8 py-3 rounded-full text-sm font-medium transition-all duration-300 ${transportType === 'train' ? 'bg-white text-slate-900 shadow-[0_2px_10px_rgba(0,0,0,0.04)]' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Regular Train
              </button>
            </div>

            {/* Trip Type */}
            <div className="flex items-center gap-8 text-sm font-medium text-slate-400">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${tripType === 'one-way' ? 'border-slate-800' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'one-way' && <div className="w-2 h-2 bg-slate-800 rounded-full" />}
                </div>
                <input type="radio" name="tripType" className="hidden" checked={tripType === 'one-way'} onChange={() => setTripType('one-way')} />
                <span className={`transition-colors ${tripType === 'one-way' ? 'text-slate-800' : 'group-hover:text-slate-600'}`}>One Way</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${tripType === 'round-trip' ? 'border-slate-800' : 'border-slate-300 group-hover:border-slate-400'}`}>
                  {tripType === 'round-trip' && <div className="w-2 h-2 bg-slate-800 rounded-full" />}
                </div>
                <input type="radio" name="tripType" className="hidden" checked={tripType === 'round-trip'} onChange={() => setTripType('round-trip')} />
                <span className={`transition-colors ${tripType === 'round-trip' ? 'text-slate-800' : 'group-hover:text-slate-600'}`}>Round Trip</span>
              </label>
            </div>
          </div>

          {/* Station Selector & Swap */}
          <div className="relative flex items-center justify-between bg-slate-50/50 rounded-[2rem] p-8 md:p-12 mb-10">
            {/* Origin */}
            <div className="flex-1 text-center">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">From</div>
              <div className="text-6xl md:text-7xl font-bold text-slate-800 tracking-tighter">台北</div>
              <div className="text-slate-400 font-medium mt-3 text-lg">Taipei</div>
            </div>

            {/* Swap Button */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <button className="w-16 h-16 bg-white rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.08)] flex items-center justify-center hover:scale-105 hover:shadow-[0_10px_40px_rgba(0,0,0,0.12)] transition-all text-slate-700">
                <ArrowRightLeft className="w-6 h-6 stroke-[2]" />
              </button>
            </div>

            {/* Destination */}
            <div className="flex-1 text-center">
              <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-3">To</div>
              <div className="text-6xl md:text-7xl font-bold text-slate-800 tracking-tighter">高雄</div>
              <div className="text-slate-400 font-medium mt-3 text-lg">Kaohsiung</div>
            </div>
          </div>

          {/* Horizontal Date Scroller */}
          <div className="mb-12">
            <div className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-5 px-2">Select Date</div>
            <div className="flex overflow-x-auto gap-4 pb-4 px-2 -mx-2 hide-scrollbar">
              {dates.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDate(d.id)}
                  className={`flex flex-col items-center justify-center min-w-[100px] py-4 px-6 rounded-2xl transition-all duration-300 ${
                    selectedDate === d.id
                      ? 'bg-slate-900 text-white shadow-[0_8px_20px_rgba(0,0,0,0.15)]'
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <span className={`text-sm font-medium mb-1 ${selectedDate === d.id ? 'text-slate-300' : 'text-slate-400'}`}>
                    {d.label}
                  </span>
                  <span className={`text-lg font-bold ${selectedDate === d.id ? 'text-white' : 'text-slate-700'}`}>
                    {d.date}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* High Contrast Search Button */}
          <button className="w-full bg-slate-900 text-white py-6 rounded-full text-xl font-medium flex items-center justify-center gap-3 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.5)] hover:shadow-[0_20px_40px_-10px_rgba(15,23,42,0.6)] hover:-translate-y-1 transition-all duration-300">
            <Search className="w-6 h-6 stroke-[2]" />
            查詢時刻與動態
          </button>

        </div>
      </section>

      {/* Search Results Section */}
      <section className="max-w-5xl mx-auto px-4 md:px-8 pb-32 -mt-8 relative z-20">
        
        {/* Quick Filters */}
        <div className="flex overflow-x-auto gap-3 pb-6 hide-scrollbar">
          {[
            { id: 'fastest', label: '最快抵達' },
            { id: 'cheapest', label: '票價最低' },
            { id: 'reserved', label: '僅顯示對號座' },
            { id: 'accessible', label: '無障礙車廂' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-medium transition-all border ${
                activeFilter === f.id
                  ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-[0_2px_10px_rgba(59,130,246,0.15)]'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results List Container */}
        <div className="bg-[#F8F9FA] rounded-3xl">
          {/* Results Header */}
          <div className="mb-6 px-2">
            <h2 className="text-sm font-semibold text-slate-500 tracking-wide">
              台北 往 高雄 <span className="mx-2 opacity-50">•</span> 共找到 24 班列車
            </h2>
          </div>

          {/* Results List */}
          <div className="flex flex-col gap-5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="bg-white rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] border border-slate-100/50 relative overflow-hidden">
                  {/* Shimmer Effect */}
                  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent z-20"></div>
                  
                  <div className="flex flex-col md:flex-row justify-between gap-8 opacity-40">
                    {/* Left: Vertical Timeline Skeleton */}
                    <div className="flex items-stretch gap-8">
                      <div className="flex flex-col items-center justify-between py-2.5">
                        <div className="w-3.5 h-3.5 rounded-full bg-slate-300"></div>
                        <div className="w-[2px] h-full bg-slate-200 my-1"></div>
                        <div className="w-3.5 h-3.5 rounded-full bg-slate-300"></div>
                      </div>
                      <div className="flex flex-col justify-between py-1">
                        <div className="w-24 h-10 bg-slate-200 rounded-lg"></div>
                        <div className="w-16 h-6 bg-slate-200 rounded-md my-5"></div>
                        <div className="w-24 h-10 bg-slate-200 rounded-lg"></div>
                      </div>
                    </div>
                    {/* Right: Info Skeleton */}
                    <div className="flex flex-col items-start md:items-end justify-between gap-6 w-full md:w-auto">
                      <div className="flex flex-col items-start md:items-end gap-3 w-full">
                        <div className="w-20 h-6 bg-slate-200 rounded-full"></div>
                        <div className="flex gap-3">
                          <div className="w-16 h-6 bg-slate-200 rounded-md"></div>
                          <div className="w-24 h-6 bg-slate-200 rounded-md"></div>
                        </div>
                      </div>
                      <div className="flex gap-4 mt-2">
                        <div className="w-24 h-8 bg-slate-200 rounded-md"></div>
                        <div className="w-20 h-6 bg-slate-200 rounded-full mt-1"></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              [
                { 
                  id: 1, type: '普悠瑪', number: '111', dep: '08:10', arr: '11:50', duration: '3h 40m', color: 'red', price: 'NT$ 843', status: 'on-time', seatStatus: 'available',
                  stops: [
                    { station: '台北', time: '08:10', passed: true },
                    { station: '板橋', time: '08:18', passed: true },
                    { station: '桃園', time: '08:40', passed: false, current: true },
                    { station: '台中', time: '09:50', passed: false },
                    { station: '台南', time: '11:15', passed: false },
                    { station: '高雄', time: '11:50', passed: false },
                  ]
                },
                { 
                  id: 2, type: '自強號', number: '115', dep: '08:30', arr: '13:15', duration: '4h 45m', color: 'orange', price: 'NT$ 843', status: 'delayed', delayMinutes: 15, seatStatus: 'limited',
                  stops: [
                    { station: '台北', time: '08:30', passed: true },
                    { station: '板橋', time: '08:39', passed: false, current: true },
                    { station: '新竹', time: '09:25', passed: false },
                    { station: '台中', time: '10:40', passed: false },
                    { station: '嘉義', time: '11:55', passed: false },
                    { station: '台南', time: '12:40', passed: false },
                    { station: '高雄', time: '13:15', passed: false },
                  ]
                },
                { 
                  id: 3, type: '區間車', number: '3123', dep: '08:45', arr: '15:30', duration: '6h 45m', color: 'blue', price: 'NT$ 542', status: 'on-time', seatStatus: 'sold-out',
                  stops: [
                    { station: '台北', time: '08:45', passed: true },
                    { station: '萬華', time: '08:50', passed: true },
                    { station: '板橋', time: '08:55', passed: true },
                    { station: '樹林', time: '09:02', passed: false, current: true },
                    { station: '...', time: '', passed: false },
                    { station: '高雄', time: '15:30', passed: false },
                  ]
                },
                { 
                  id: 4, type: '太魯閣', number: '402', dep: '09:15', arr: '12:30', duration: '3h 15m', color: 'red', price: 'NT$ 783', status: 'cancelled', seatStatus: 'sold-out',
                  stops: []
                },
              ].map(train => (
                <div 
                  key={train.id} 
                  onClick={() => train.status !== 'cancelled' && setExpandedTrainId(expandedTrainId === train.id ? null : train.id)}
                  className={`group rounded-[2rem] shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] transition-all border overflow-hidden relative ${
                    train.status === 'cancelled' 
                      ? 'bg-slate-50 border-slate-200 opacity-75 cursor-not-allowed' 
                      : expandedTrainId === train.id 
                        ? 'bg-white border-blue-200 cursor-pointer' 
                        : 'bg-white border-slate-100/50 hover:border-blue-200 hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.15)] cursor-pointer'
                  }`}
                >
                {/* Cancelled Stamp */}
                {train.status === 'cancelled' && (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-15deg] border-[6px] border-red-500/80 text-red-500/80 text-4xl md:text-5xl font-black tracking-widest px-8 py-3 rounded-2xl z-20 pointer-events-none mix-blend-multiply">
                    停駛 CANCELLED
                  </div>
                )}

                {/* Main Card Content */}
                <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-8 relative">
                  
                  {/* Left: Vertical Timeline */}
                  <div className="flex items-stretch gap-8">
                    {/* Timeline Graphic */}
                    <div className="flex flex-col items-center justify-between py-2.5">
                      <div className={`w-3.5 h-3.5 rounded-full border-[3px] border-slate-800 z-10 ${train.status === 'cancelled' ? 'bg-slate-200 border-slate-400' : 'bg-white'}`}></div>
                      <div className={`w-[2px] h-full my-1 rounded-full ${train.status === 'cancelled' ? 'bg-slate-300' : 'bg-slate-200'}`}></div>
                      <div className={`w-3.5 h-3.5 rounded-full z-10 ${train.status === 'cancelled' ? 'bg-slate-400' : 'bg-slate-800'}`}></div>
                    </div>
                    
                    {/* Times & Duration */}
                    <div className="flex flex-col justify-between py-1">
                      <div className={`text-4xl font-bold text-slate-800 tracking-tighter ${train.status === 'cancelled' ? 'line-through opacity-50' : ''}`}>{train.dep}</div>
                      <div className={`text-sm font-semibold text-slate-400 my-5 bg-slate-50 w-fit px-3 py-1 rounded-lg ${train.status === 'cancelled' ? 'opacity-50' : ''}`}>{train.duration}</div>
                      <div className={`text-4xl font-bold text-slate-800 tracking-tighter ${train.status === 'cancelled' ? 'line-through opacity-50' : ''}`}>{train.arr}</div>
                    </div>
                  </div>

                  {/* Right: Train Info */}
                  <div className="flex flex-col items-start md:items-end justify-between gap-6 mt-6 md:mt-0 w-full md:w-auto md:pr-10">
                    
                    {/* Top Right: Live Status & Train Info */}
                    <div className="flex flex-col items-start md:items-end gap-3 w-full">
                      {/* Live Status */}
                      <div className="flex w-full md:w-auto justify-end">
                        {train.status === 'on-time' ? (
                          <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50/80 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-emerald-100">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            準點 On Time
                          </div>
                        ) : train.status === 'delayed' ? (
                          <div className="flex items-center gap-2 text-red-600 bg-red-50/80 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-red-100">
                            <span className="relative flex h-2 w-2">
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                            晚分 {train.delayMinutes} 分鐘
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-500 bg-slate-200/80 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide border border-slate-300">
                            <XCircle className="w-3 h-3" />
                            已取消 Cancelled
                          </div>
                        )}
                      </div>

                      <div className={`flex items-center gap-3 ${train.status === 'cancelled' ? 'opacity-50' : ''}`}>
                        {/* Train Type Badge */}
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest ${
                          train.color === 'red' ? 'bg-red-100 text-red-700' :
                          train.color === 'orange' ? 'bg-orange-100 text-orange-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {train.type}
                        </span>
                        {/* Train Number */}
                        <span className="text-xl font-bold text-slate-700 tracking-tight">{train.type} {train.number} 次</span>
                      </div>
                    </div>
                    
                    {/* Bottom Right: Price & Seat */}
                    <div className={`flex items-center justify-between md:justify-end w-full md:w-auto gap-5 mt-2 bg-slate-50 md:bg-transparent p-4 md:p-0 rounded-2xl md:rounded-none ${train.status === 'cancelled' ? 'opacity-50' : ''}`}>
                      <span className={`text-3xl font-light text-slate-800 tracking-tight ${train.status === 'cancelled' ? 'line-through' : ''}`}>{train.price}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 hidden md:block"></span>
                      
                      {/* Seat Status */}
                      {train.seatStatus === 'available' && (
                        <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                          <CheckCircle className="w-5 h-5" /> 尚有座位
                        </div>
                      )}
                      {train.seatStatus === 'limited' && (
                        <div className="flex items-center gap-1.5 text-amber-500 font-medium text-sm">
                          <AlertCircle className="w-5 h-5" /> 座位有限
                        </div>
                      )}
                      {train.seatStatus === 'sold-out' && (
                        <div className="flex items-center gap-1.5 text-slate-400 font-medium text-sm">
                          <XCircle className="w-5 h-5" /> 已售完
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expand Icon */}
                  {train.status !== 'cancelled' && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                      <ChevronDown className={`w-6 h-6 text-blue-500 transition-transform duration-300 ${expandedTrainId === train.id ? 'rotate-180' : ''}`} />
                    </div>
                  )}
                </div>

                {/* Expanded Stops Timeline */}
                {expandedTrainId === train.id && (
                  <div className="bg-slate-900 p-8 md:p-10 border-t border-slate-800 animate-in slide-in-from-top-4 fade-in duration-300">
                    <h4 className="text-slate-400 text-sm font-semibold uppercase tracking-widest mb-8">Route Map</h4>
                    <div className="flex flex-col">
                      {train.stops.map((stop, idx) => (
                        <div key={idx} className="flex items-center gap-6 relative group/stop">
                          {/* Vertical Line */}
                          {idx !== train.stops.length - 1 && (
                            <div className={`absolute left-[11px] top-6 bottom-[-24px] w-[2px] ${stop.passed ? 'bg-blue-500/50' : 'bg-slate-700'}`}></div>
                          )}
                          
                          {/* Dot */}
                          <div className={`w-6 h-6 rounded-full border-4 border-slate-900 flex items-center justify-center z-10 transition-colors ${
                            stop.current ? 'bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,0.4)]' : 
                            stop.passed ? 'bg-blue-500/50' : 'bg-slate-700'
                          }`}>
                            {stop.current && <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>}
                          </div>
                          
                          {/* Info */}
                          <div className={`flex items-center gap-5 py-4 transition-opacity w-full ${stop.passed && !stop.current ? 'opacity-40' : 'opacity-100'}`}>
                            <span className={`text-xl font-bold tracking-tight ${stop.current ? 'text-blue-400' : 'text-white'}`}>
                              {stop.station}
                            </span>
                            <span className="text-slate-400 font-mono text-lg">{stop.time}</span>
                            {stop.current && (
                              <span className="text-xs font-bold tracking-widest bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg ml-2">
                                目前位置
                              </span>
                            )}
                            {/* Weather Integration for Destination */}
                            {idx === train.stops.length - 1 && (
                              <div className="ml-auto flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700">
                                {stop.station === '高雄' ? <Sun className="w-4 h-4 text-amber-400" /> : <CloudRain className="w-4 h-4 text-blue-400" />}
                                <span className="text-sm font-medium text-slate-300">28°C</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Seat Availability Heatmap */}
                    <div className="mt-8 pt-8 border-t border-slate-800">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-slate-400 text-sm font-semibold uppercase tracking-widest">車廂擁擠度預測</h4>
                        <span className="text-xs text-slate-500 font-medium">即時更新</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400">1車</div>
                        <div className="flex-1 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-sm font-bold text-emerald-400">2車</div>
                        <div className="flex-1 h-10 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-sm font-bold text-amber-400">3車</div>
                        <div className="flex-1 h-10 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-sm font-bold text-orange-400">4車</div>
                        <div className="flex-1 h-10 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-sm font-bold text-red-400">5車</div>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 mt-3 font-medium px-1">
                        <span>空曠 (舒適)</span>
                        <span>擁擠 (站立)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )))}
          </div>
        </div>
      </section>
      {/* Approaching Station Toast */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-500">
        <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700 text-white px-6 py-4 rounded-full shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-4 cursor-pointer hover:scale-105 transition-transform">
          <div className="bg-blue-500/20 p-2 rounded-full">
            <Train className="w-5 h-5 text-blue-400 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <div className="text-sm font-bold tracking-wide">即將抵達：台中 <span className="text-blue-400">(還有 3 分鐘)</span></div>
            <div className="text-xs text-slate-400 font-medium mt-0.5">預計停靠第 2B 月台</div>
          </div>
        </div>
      </div>
    </div>
  );
}
