// Write a program that counts the number of vowels in a sentence.
function vowelscount()
{
let input = prompt("enter a sentence")
let vowels = ['a','e','i','o','u','A','E','I','O','U']
let increment = 0
for(let char of input)
{
  if(vowels.includes(char))
  increment++
}
console.log(increment + " vowels in " + input)
alert(increment + " vowels in " + input)
}
vowelscount()