// Question 4: Capitalize Words
// Write a program that accepts a string as input, capitalizes the first letter of each word in the
// string, and then returns the result string
let sample = prompt("enter a sample string")
console.log(sample)
const deer = sample.split(" ")
const maya = deer.map(inol => {
    if(inol.length === 0) return inol
    return ((inol.charAt(0).toUpperCase()) + inol.slice(1)) 
})
const lima = maya.join(" ")
console.log(lima)