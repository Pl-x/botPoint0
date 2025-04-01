// Question 4: Capitalize Words
// Write a program that accepts a string as input, capitalizes the first letter of each word in the
// string, and then returns the result string
let sample = 'ellan' || 'gio' || 'sleth' || 'lobster'
const sliced2 = sample.slice(0,1)
const sliced = sample.slice(1)
const brand = (sliced2.toUpperCase()).concat(sliced)
console.log(brand)